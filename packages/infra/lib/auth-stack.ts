import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as path from "path";
import { Construct } from "constructs";

export interface AuthStackProps extends cdk.StackProps {
  /** Allow visitors to self-register. Set to true for prod; leave false (default) for dev. */
  allowSelfSignUp?: boolean;
  /**
   * Comma-separated email allowlist enforced by the PreSignUp Lambda. When set,
   * only these emails can sign in (native or Google). Omit for open enrollment (prod).
   */
  googleEmailAllowlist?: string;
  /** Additional OAuth callback URLs registered on the SPA client (e.g. prod domain). */
  oauthCallbackUrls?: string[];
  /** Additional OAuth logout URLs registered on the SPA client (e.g. prod domain). */
  oauthLogoutUrls?: string[];
  /**
   * Custom domain for the Cognito Hosted UI (e.g. "auth.bookshelf.whoiskevinrich.com").
   * Requires a cert in us-east-1 covering the domain and crossRegionReferences on this stack.
   * When omitted, falls back to a Cognito-managed domain (bookshelf-<account>.auth…).
   */
  cognitoCustomDomain?: {
    domainName: string;
    certificate: acm.ICertificate;
    /** Route53 hosted zone name used to add the CNAME record (e.g. "bookshelf.whoiskevinrich.com"). */
    hostedZoneName: string;
  };
}

export class AuthStack extends cdk.Stack {
  /** Cognito User Pool ID — consumed by ApiStack and WebStack */
  readonly userPoolId: string;
  /** App Client ID — passed to the SPA as a public identifier */
  readonly userPoolClientId: string;
  /** MCP OAuth app client ID — used by McpStack for token audience validation */
  readonly mcpClientId: string;
  /** Cognito Hosted UI base URL — used by McpStack for OAuth discovery documents */
  readonly hostedUiBaseUrl: string;
  /** JWKS issuer URL — used by Lambda JWT verification and ApiStack env vars */
  readonly userPoolIssuer: string;
  /**
   * Cognito Hosted UI domain FQDN (no scheme), e.g.
   * "bookshelf-123456789012.auth.us-west-2.amazoncognito.com".
   * Passed to the SPA as the Amplify oauth.domain config value.
   */
  readonly hostedUiDomain: string;

  constructor(scope: Construct, id: string, props: AuthStackProps = {}) {
    super(scope, id, props);
    const {
      allowSelfSignUp = false,
      googleEmailAllowlist,
      oauthCallbackUrls,
      oauthLogoutUrls,
      cognitoCustomDomain,
    } = props;

    // ── User Pool ──────────────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "bookshelf-users",
      selfSignUpEnabled: allowSelfSignUp,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // never accidentally delete user accounts
    });

    // ── Google identity provider ──────────────────────────────────────────
    //
    // Credentials are resolved at deploy time (never in source):
    //   /bookshelf/google/client-id      — SSM String  (public OAuth client ID)
    //   /bookshelf/google/client-secret  — Secrets Manager (OAuth client secret)
    //
    // CloudFormation does not support SSM SecureString dynamic references in
    // AWS::Cognito::UserPoolIdentityProvider, so the secret must live in
    // Secrets Manager instead of SSM SecureString.
    //
    // Create these before the first `cdk deploy`:
    //   aws ssm put-parameter --name /bookshelf/google/client-id --value <id> --type String
    //   aws secretsmanager create-secret --name /bookshelf/google/client-secret --secret-string <secret>
    const googleIdp = new cognito.UserPoolIdentityProviderGoogle(this, "GoogleIdp", {
      userPool,
      clientId: ssm.StringParameter.valueForStringParameter(this, "/bookshelf/google/client-id"),
      clientSecretValue: cdk.SecretValue.secretsManager("/bookshelf/google/client-secret"),
      scopes: ["email", "openid", "profile"],
      attributeMapping: {
        // Maps Google's email to the Cognito email attribute.
        // Cognito skips immutable attribute updates on subsequent sign-ins,
        // so mutable:false on the pool's email attribute is safe here.
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
      },
    });

    // ── App Client (SPA — public, no client secret) ────────────────────────
    const appClient = userPool.addClient("SpaClient", {
      userPoolClientName: "bookshelf-spa",
      generateSecret: false, // PKCE flow — the SPA cannot keep a secret safe in the browser
      authFlows: {
        userSrp: true, // standard SRP auth for the Amplify Auth SDK
        userPassword: true, // enabled for server-side password re-auth (DELETE /v1/users/me)
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      ],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        // localhost:5173 is Vite's default dev port; additional prod URLs come from props
        callbackUrls: ["http://localhost:5173/auth/callback", ...(oauthCallbackUrls ?? [])],
        logoutUrls: ["http://localhost:5173", ...(oauthLogoutUrls ?? [])],
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // CloudFormation must create the Google IdP before the app client references it
    // in supportedIdentityProviders. Use L1 resources directly — addDependency at
    // the L2 level pulls in all construct descendants and creates a cycle through
    // the shared UserPool.
    const cfnAppClient = appClient.node.defaultChild as cognito.CfnUserPoolClient;
    const cfnGoogleIdp = googleIdp.node.defaultChild as cognito.CfnUserPoolIdentityProvider;
    cfnAppClient.addDependency(cfnGoogleIdp);

    // ── PreSignUp Lambda (allowlist + Google account linking) ─────────────
    //
    // Runs before Cognito creates a new user. Does two things:
    //   1. Rejects sign-ins from emails not in EMAIL_ALLOWLIST (dev only)
    //   2. Links a new Google sign-in to an existing native account with the
    //      same email, preserving the user's sub and all their shelf data.
    const preSignUpFn = new lambda.Function(this, "PreSignUpFn", {
      functionName: "bookshelf-pre-signup",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambda", "pre-signup")),
      timeout: cdk.Duration.seconds(5),
      description: "Cognito PreSignUp trigger — email allowlist + Google account linking",
      environment: {
        EMAIL_ALLOWLIST: googleEmailAllowlist ?? "",
      },
      // Explicit log group with a CDK-generated name. With
      // `@aws-cdk/aws-lambda:useCdkManagedLogGroup`, the default managed group is
      // named `/aws/lambda/<functionName>` — colliding with the one this Lambda
      // auto-created before the flag (an environment that deployed pre-flag rejects
      // the change set: "LogGroup already exists"). A dedicated group avoids it.
      logGroup: new logs.LogGroup(this, "PreSignUpFnLogGroup", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // Scope to all user pools in this account+region rather than referencing the specific
    // pool ARN. Using userPool.userPoolArn (Fn::GetAtt) here would create a CloudFormation
    // cycle: UserPool → PreSignUpFn → IAMPolicy → UserPool.
    preSignUpFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["cognito-idp:ListUsers", "cognito-idp:AdminLinkProviderForUser"],
        resources: [
          `arn:${cdk.Aws.PARTITION}:cognito-idp:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:userpool/*`,
        ],
      }),
    );

    userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUpFn);

    // ── Hosted UI domain (required for MCP OAuth authorization code flow) ────
    //
    // Prod uses a custom domain (auth.bookshelf.whoiskevinrich.com) so Google's
    // account chooser shows the branded domain instead of the Cognito-managed one.
    // Dev falls back to a Cognito-managed domain (bookshelf-<account>.auth…).
    // A Cognito custom domain (prod) can only be created once its parent apex
    // (e.g. bookshelf.whoiskevinrich.com) resolves to a DNS A record — which is the
    // WebStack's CloudFront alias. Since WebStack depends on this stack's outputs,
    // the very first prod bring-up is a chicken-and-egg: gate the UserPoolDomain
    // resource on the `authCustomDomain` context flag (default true) so it can be
    // bootstrapped in order:
    //   1. deploy Auth with `-c authCustomDomain=false` (no domain resource yet)
    //   2. deploy Web (creates the apex A record)
    //   3. deploy Auth with the default (creates the custom domain — apex A now resolves)
    // Steady-state deploys use the default: the apex A record persists, so the domain
    // creates/updates cleanly. The hosted-UI domain string is deterministic, so the
    // exported hostedUiDomain/BaseUrl are always literals for the custom-domain case
    // and never depend on the resource existing (decoupling MCP/Web from deploy order).
    const createCustomDomain =
      !!cognitoCustomDomain && this.node.tryGetContext("authCustomDomain") !== "false";

    let hostedUiDomain: string;
    let hostedUiBaseUrl: string;

    if (cognitoCustomDomain) {
      hostedUiDomain = cognitoCustomDomain.domainName;
      hostedUiBaseUrl = `https://${cognitoCustomDomain.domainName}`;

      if (createCustomDomain) {
        const userPoolDomain = userPool.addDomain("HostedUiDomain", {
          customDomain: {
            domainName: cognitoCustomDomain.domainName,
            certificate: cognitoCustomDomain.certificate,
          },
        });
        const hostedZone = route53.HostedZone.fromLookup(this, "CognitoAuthZone", {
          domainName: cognitoCustomDomain.hostedZoneName,
        });
        new route53.CnameRecord(this, "CognitoAuthCname", {
          zone: hostedZone,
          recordName: cognitoCustomDomain.domainName,
          domainName: userPoolDomain.cloudFrontDomainName,
          ttl: cdk.Duration.minutes(5),
        });
      }
    } else {
      const userPoolDomain = userPool.addDomain("HostedUiDomain", {
        cognitoDomain: {
          domainPrefix: `bookshelf-${cdk.Aws.ACCOUNT_ID}`,
        },
      });
      hostedUiDomain = `${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`;
      hostedUiBaseUrl = userPoolDomain.baseUrl();
    }

    // ── MCP app client (OAuth authorization code + PKCE) ─────────────────────
    //
    // Separate from the SPA client so MCP tokens can be independently revoked.
    // Claude Desktop redirects to localhost after the user logs in — the port
    // is not fixed, so we register the common range used by MCP clients.
    const mcpClient = userPool.addClient("McpClient", {
      userPoolClientName: "bookshelf-mcp",
      generateSecret: false,
      authFlows: { userSrp: false, userPassword: false },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: [
          "http://localhost:54321/callback", // Claude Desktop MCP OAuth callback port
          "http://localhost:3000/callback", // local dev / MCP Inspector
        ],
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ── Custom message Lambda (HTML email templates for Cognito-triggered emails) ──
    const customMessageFn = new lambda.Function(this, "CustomMessageFn", {
      functionName: "bookshelf-custom-message",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambda", "custom-message")),
      timeout: cdk.Duration.seconds(5),
      description:
        "Cognito custom message trigger — HTML email templates for verification, password reset, and invitations",
      // Explicit log group (see PreSignUpFn) to avoid the
      // `/aws/lambda/bookshelf-custom-message` managed-group name collision in
      // environments that deployed before useCdkManagedLogGroup was enabled.
      logGroup: new logs.LogGroup(this, "CustomMessageFnLogGroup", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    userPool.addTrigger(cognito.UserPoolOperation.CUSTOM_MESSAGE, customMessageFn);

    // ── CloudFormation outputs ─────────────────────────────────────────────
    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;

    this.userPoolId = userPool.userPoolId;
    this.userPoolClientId = appClient.userPoolClientId;
    this.mcpClientId = mcpClient.userPoolClientId;
    this.hostedUiBaseUrl = hostedUiBaseUrl;
    this.userPoolIssuer = issuer;
    this.hostedUiDomain = hostedUiDomain;

    new cdk.CfnOutput(this, "UserPoolIdOutput", {
      exportName: "BookshelfUserPoolId",
      value: userPool.userPoolId,
    });
    new cdk.CfnOutput(this, "UserPoolClientIdOutput", {
      exportName: "BookshelfUserPoolClientId",
      value: appClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, "McpClientIdOutput", {
      exportName: "BookshelfMcpClientId",
      value: mcpClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, "HostedUiBaseUrlOutput", {
      exportName: "BookshelfHostedUiBaseUrl",
      value: hostedUiBaseUrl,
    });
    new cdk.CfnOutput(this, "HostedUiDomainOutput", {
      exportName: "BookshelfHostedUiDomain",
      value: hostedUiDomain,
      description: "Cognito Hosted UI FQDN (no scheme) — used by Amplify oauth.domain config",
    });
    new cdk.CfnOutput(this, "UserPoolIssuerOutput", {
      exportName: "BookshelfUserPoolIssuer",
      value: issuer,
      description: "JWKS issuer URL — used by Lambda JWT verification",
    });
  }
}
