import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
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
}

export class AuthStack extends cdk.Stack {
  /** Cognito User Pool ID — consumed by ApiStack and WebStack */
  readonly userPoolId: string;
  readonly userPoolArn: string;
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
    // Credentials are stored in SSM (never in source) and resolved at deploy time:
    //   /bookshelf/google/client-id      — String (OAuth client ID is public)
    //   /bookshelf/google/client-secret  — SecureString (OAuth client secret)
    //
    // Create these parameters manually before the first `cdk deploy`.
    const googleIdp = new cognito.UserPoolIdentityProviderGoogle(this, "GoogleIdp", {
      userPool,
      clientId: ssm.StringParameter.valueForStringParameter(this, "/bookshelf/google/client-id"),
      clientSecretValue: cdk.SecretValue.ssmSecure("/bookshelf/google/client-secret"),
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
    });

    // Allow the Lambda to list users and link identities in this pool
    preSignUpFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["cognito-idp:ListUsers", "cognito-idp:AdminLinkProviderForUser"],
        resources: [userPool.userPoolArn],
      }),
    );

    userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUpFn);

    // ── Hosted UI domain (required for MCP OAuth authorization code flow) ────
    //
    // Uses a Cognito-managed domain (free). The prefix is unique per account so
    // dev and prod don't collide. MCP clients (Claude Desktop) redirect the user
    // here for login and receive an authorization code via PKCE callback.
    const userPoolDomain = userPool.addDomain("HostedUiDomain", {
      cognitoDomain: {
        domainPrefix: `bookshelf-${cdk.Aws.ACCOUNT_ID}`,
      },
    });

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
    });
    userPool.addTrigger(cognito.UserPoolOperation.CUSTOM_MESSAGE, customMessageFn);

    // ── SSM Parameters (read by CDK outputs + CI deploy scripts) ──────────
    new ssm.StringParameter(this, "UserPoolIdParam", {
      parameterName: "/bookshelf/cognito/user-pool-id",
      stringValue: userPool.userPoolId,
      description: "Bookshelf Cognito User Pool ID",
    });
    new ssm.StringParameter(this, "UserPoolClientIdParam", {
      parameterName: "/bookshelf/cognito/client-id",
      stringValue: appClient.userPoolClientId,
      description: "Bookshelf Cognito SPA App Client ID",
    });
    new ssm.StringParameter(this, "McpClientIdParam", {
      parameterName: "/bookshelf/cognito/mcp-client-id",
      stringValue: mcpClient.userPoolClientId,
      description: "Bookshelf Cognito MCP App Client ID",
    });
    new ssm.StringParameter(this, "HostedUiBaseUrlParam", {
      parameterName: "/bookshelf/cognito/hosted-ui-base-url",
      stringValue: userPoolDomain.baseUrl(),
      description: "Cognito Hosted UI base URL for OAuth discovery",
    });

    // FQDN without scheme — used by Amplify's loginWith.oauth.domain config
    const hostedUiDomain = `${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`;
    new ssm.StringParameter(this, "HostedUiDomainParam", {
      parameterName: "/bookshelf/cognito/hosted-ui-domain",
      stringValue: hostedUiDomain,
      description: "Cognito Hosted UI domain FQDN (no scheme) — used by Amplify oauth config",
    });

    // ── CloudFormation outputs ─────────────────────────────────────────────
    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;

    this.userPoolId = userPool.userPoolId;
    this.userPoolArn = userPool.userPoolArn;
    this.userPoolClientId = appClient.userPoolClientId;
    this.mcpClientId = mcpClient.userPoolClientId;
    this.hostedUiBaseUrl = userPoolDomain.baseUrl();
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
      value: userPoolDomain.baseUrl(),
    });
    new cdk.CfnOutput(this, "UserPoolIssuerOutput", {
      exportName: "BookshelfUserPoolIssuer",
      value: issuer,
      description: "JWKS issuer URL — used by Lambda JWT verification",
    });
  }
}
