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

/**
 * Blue/green pool cutover phase (ADR-015). Selected via `-c authPool=…` in bin/bookshelf.ts.
 *
 *  - `legacy`  — only the original pool (gen1, immutable email). Steady state / pre-migration.
 *  - `cutover` — both pools exist; outputs expose the GREEN pool (gen2, mutable email) so the
 *                consumer stacks repoint to it, while gen1 stays live for rollback.
 *  - `green`   — only the green pool (gen2). Post-migration steady state; gen1 is dropped
 *                (its RETAINed pool shell is orphaned, freeing the gen1 Hosted-UI domain).
 *
 * email mutability MUST differ by generation: gen1 stays immutable (changing it would replace
 * the live pool — the very thing we are avoiding), gen2 is mutable so Cognito's per-sign-in IdP
 * attribute re-sync no longer throws "user.email: Attribute cannot be updated."
 * See docs/runbooks/cognito-email-mutable-migration.md and docs/adrs/015-*.md.
 */
export const AUTH_POOL_PHASES = ["legacy", "cutover", "green"] as const;
export type AuthPoolPhase = (typeof AUTH_POOL_PHASES)[number];

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
  /**
   * Blue/green migration phase (ADR-015). Defaults to `legacy` (the original single pool).
   */
  poolPhase?: AuthPoolPhase;
}

/** Identifiers a single pool generation exposes to the rest of the app. */
interface PoolGeneration {
  userPoolId: string;
  spaClientId: string;
  mcpClientId: string;
  /** JWKS issuer URL for this pool's tokens. */
  issuer: string;
  /** Hosted UI FQDN (no scheme) — used as the Amplify oauth.domain value. */
  hostedUiDomain: string;
  /** Hosted UI base URL (with scheme) — used by MCP OAuth discovery. */
  hostedUiBaseUrl: string;
  /**
   * Raw CloudFormation token for the managed Hosted-UI domain name (the value other stacks
   * import). Used to pin gen1's export during a cutover (see exportValue below). Undefined for
   * a custom domain, whose Hosted-UI value is a literal string (not a cross-stack export).
   */
  hostedUiDomainRef?: string;
}

export class AuthStack extends cdk.Stack {
  /** Cognito User Pool ID — consumed by ApiStack and WebStack (active generation) */
  readonly userPoolId: string;
  /** App Client ID — passed to the SPA as a public identifier (active generation) */
  readonly userPoolClientId: string;
  /** MCP OAuth app client ID — used by McpStack for token audience validation (active generation) */
  readonly mcpClientId: string;
  /** Cognito Hosted UI base URL — used by McpStack for OAuth discovery documents (active generation) */
  readonly hostedUiBaseUrl: string;
  /** JWKS issuer URL — used by Lambda JWT verification and ApiStack env vars (active generation) */
  readonly userPoolIssuer: string;
  /**
   * Cognito Hosted UI domain FQDN (no scheme), e.g.
   * "bookshelf-123456789012.auth.us-west-2.amazoncognito.com" (active generation).
   * Passed to the SPA as the Amplify oauth.domain config value.
   */
  readonly hostedUiDomain: string;
  /**
   * The LEGACY (gen1) issuer during a `cutover`, else undefined. ApiStack adds this as a
   * secondary trusted issuer so sessions minted before the cutover keep working for their
   * remaining lifetime (≤1h). Keeping gen1 referenced cross-stack here also prevents CDK from
   * removing the in-use gen1 export mid-cutover (ADR-015).
   */
  readonly legacyUserPoolIssuer?: string;
  /** The LEGACY (gen1) SPA client id during a `cutover`, else undefined — secondary audience. */
  readonly legacyUserPoolClientId?: string;

  constructor(scope: Construct, id: string, props: AuthStackProps = {}) {
    super(scope, id, props);
    const {
      allowSelfSignUp = false,
      googleEmailAllowlist,
      oauthCallbackUrls,
      oauthLogoutUrls,
      cognitoCustomDomain,
      poolPhase = "legacy",
    } = props;

    // ── Shared Cognito-trigger Lambdas ─────────────────────────────────────
    //
    // Created ONCE and attached as triggers to every pool generation. They are
    // pool-agnostic at runtime (PreSignUp reads event.userPoolId; IAM is scoped to
    // userpool/* in this account+region), so one Lambda safely serves both pools
    // during a cutover — and keeping a single functionName avoids name collisions.

    // PreSignUp — allowlist + Google account linking.
    //   1. Rejects sign-ins from emails not in EMAIL_ALLOWLIST (dev only)
    //   2. Links a new Google sign-in to an existing native account with the same
    //      email, preserving the user's sub and all their shelf data.
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

    // Custom message — HTML email templates for Cognito-triggered emails.
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

    // ── Pool generations ───────────────────────────────────────────────────
    // legacy → gen1 only; cutover → gen1 + gen2 (expose gen2); green → gen2 only.
    const sharedTriggers = { preSignUpFn, customMessageFn };
    const commonGenProps = {
      allowSelfSignUp,
      oauthCallbackUrls,
      oauthLogoutUrls,
      cognitoCustomDomain,
      ...sharedTriggers,
    };

    const needGen1 = poolPhase === "legacy" || poolPhase === "cutover";
    const needGen2 = poolPhase === "cutover" || poolPhase === "green";

    // gen1 keeps the EXACT original construct IDs (idSuffix "") and immutable email, so existing
    // deployed resources are never replaced. gen2 is suffixed, mutable, on a distinct domain.
    const gen1 = needGen1
      ? this.createPoolGeneration({ ...commonGenProps, idSuffix: "", mutableEmail: false })
      : undefined;
    const gen2 = needGen2
      ? this.createPoolGeneration({ ...commonGenProps, idSuffix: "Green", mutableEmail: true })
      : undefined;

    // Active generation drives this stack's outputs (gen2 once it exists).
    const active = (gen2 ?? gen1)!;

    this.userPoolId = active.userPoolId;
    this.userPoolClientId = active.spaClientId;
    this.mcpClientId = active.mcpClientId;
    this.hostedUiBaseUrl = active.hostedUiBaseUrl;
    this.userPoolIssuer = active.issuer;
    this.hostedUiDomain = active.hostedUiDomain;

    // During cutover expose gen1 as the secondary issuer/audience so pre-cutover sessions keep
    // working AND gen1's UserPool + SpaClient exports stay referenced cross-stack.
    if (poolPhase === "cutover" && gen1) {
      this.legacyUserPoolIssuer = gen1.issuer;
      this.legacyUserPoolClientId = gen1.spaClientId;

      // The consumer stacks drop their gen1 McpClient/HostedUiDomain imports during cutover, but
      // CloudFormation refuses to delete an export while it is still imported by a not-yet-updated
      // stack mid-deploy. Pin those two exports here (exportValue reproduces their existing
      // auto-generated names) so they persist through the cutover; they fall away cleanly in the
      // green phase, when no stack imports them anymore. (UserPool + SpaClient are kept alive by
      // the secondary-issuer wiring above, so they must NOT be re-pinned — that would duplicate.)
      this.exportValue(gen1.mcpClientId);
      if (gen1.hostedUiDomainRef) this.exportValue(gen1.hostedUiDomainRef);
    }

    // ── CloudFormation outputs (named exports — for humans/CI, not imported by other stacks) ──
    new cdk.CfnOutput(this, "UserPoolIdOutput", {
      exportName: "BookshelfUserPoolId",
      value: active.userPoolId,
    });
    new cdk.CfnOutput(this, "UserPoolClientIdOutput", {
      exportName: "BookshelfUserPoolClientId",
      value: active.spaClientId,
    });
    new cdk.CfnOutput(this, "McpClientIdOutput", {
      exportName: "BookshelfMcpClientId",
      value: active.mcpClientId,
    });
    new cdk.CfnOutput(this, "HostedUiBaseUrlOutput", {
      exportName: "BookshelfHostedUiBaseUrl",
      value: active.hostedUiBaseUrl,
    });
    new cdk.CfnOutput(this, "HostedUiDomainOutput", {
      exportName: "BookshelfHostedUiDomain",
      value: active.hostedUiDomain,
      description: "Cognito Hosted UI FQDN (no scheme) — used by Amplify oauth.domain config",
    });
    new cdk.CfnOutput(this, "UserPoolIssuerOutput", {
      exportName: "BookshelfUserPoolIssuer",
      value: active.issuer,
      description: "JWKS issuer URL — used by Lambda JWT verification",
    });
  }

  /**
   * Builds one pool generation (pool + Google IdP + SPA/MCP clients + Hosted-UI domain) and
   * attaches the shared Cognito triggers. `idSuffix` is "" for the legacy gen1 (keeping the
   * original logical IDs byte-identical) and a non-empty value (e.g. "Green") for gen2, so the
   * two generations are distinct CloudFormation resources that can coexist during a cutover.
   */
  private createPoolGeneration(args: {
    idSuffix: string;
    mutableEmail: boolean;
    allowSelfSignUp: boolean;
    oauthCallbackUrls?: string[];
    oauthLogoutUrls?: string[];
    cognitoCustomDomain?: AuthStackProps["cognitoCustomDomain"];
    preSignUpFn: lambda.IFunction;
    customMessageFn: lambda.IFunction;
  }): PoolGeneration {
    const {
      idSuffix,
      mutableEmail,
      allowSelfSignUp,
      oauthCallbackUrls,
      oauthLogoutUrls,
      cognitoCustomDomain,
      preSignUpFn,
      customMessageFn,
    } = args;
    const sid = (base: string) => `${base}${idSuffix}`;

    // ── User Pool ──────────────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, sid("UserPool"), {
      userPoolName: `bookshelf-users${idSuffix ? `-${idSuffix.toLowerCase()}` : ""}`,
      selfSignUpEnabled: allowSelfSignUp,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        // email mutability is per-generation (see AuthPoolPhase): gen2 (green) is mutable so
        // Cognito's per-sign-in IdP attribute re-sync stops throwing "user.email: Attribute
        // cannot be updated."; gen1 stays immutable so the live pool is never replaced.
        email: { required: true, mutable: mutableEmail },
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
    const googleIdp = new cognito.UserPoolIdentityProviderGoogle(this, sid("GoogleIdp"), {
      userPool,
      clientId: ssm.StringParameter.valueForStringParameter(this, "/bookshelf/google/client-id"),
      clientSecretValue: cdk.SecretValue.secretsManager("/bookshelf/google/client-secret"),
      scopes: ["email", "openid", "profile"],
      attributeMapping: {
        // Maps Google's email to the Cognito email attribute. Cognito re-applies this mapping on
        // every federated sign-in, so the pool's email attribute must be mutable on gen2 (green)
        // — otherwise the second sign-in fails with "user.email: Attribute cannot be updated."
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
        // localhost:3000 is this app's dev port (vite.config.ts + API CORS default);
        // 5173 is Vite's default, kept for safety. Prod URLs come from props.
        callbackUrls: [
          "http://localhost:3000/auth/callback",
          "http://localhost:5173/auth/callback",
          ...(oauthCallbackUrls ?? []),
        ],
        logoutUrls: ["http://localhost:3000", "http://localhost:5173", ...(oauthLogoutUrls ?? [])],
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

    // ── Cognito triggers (shared Lambdas) ────────────────────────────────────
    userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUpFn);
    userPool.addTrigger(cognito.UserPoolOperation.CUSTOM_MESSAGE, customMessageFn);

    // ── Hosted UI domain ─────────────────────────────────────────────────────
    //
    // Prod uses a custom domain (auth.bookshelf.whoiskevinrich.com) so Google's account chooser
    // shows the branded domain. Dev falls back to a Cognito-managed domain (bookshelf-<account>).
    // Each generation needs a DISTINCT domain — two pools cannot share a prefix/host — so gen2
    // gets a `-g2` managed-prefix suffix (dev) or an `auth2.` host (prod custom domain).
    const createCustomDomain =
      !!cognitoCustomDomain && this.node.tryGetContext("authCustomDomain") !== "false";

    let hostedUiDomain: string;
    let hostedUiBaseUrl: string;
    let hostedUiDomainRef: string | undefined;

    if (cognitoCustomDomain) {
      // gen2 uses an `auth2.` host so it can stand up alongside gen1's `auth.` host. After
      // gen1 is retired (green phase), the `auth.` host is free to be reclaimed in a later deploy.
      const domainName = idSuffix
        ? cognitoCustomDomain.domainName.replace(/^auth\./, "auth2.")
        : cognitoCustomDomain.domainName;
      hostedUiDomain = domainName;
      hostedUiBaseUrl = `https://${domainName}`;

      if (createCustomDomain) {
        const userPoolDomain = userPool.addDomain("HostedUiDomain", {
          customDomain: { domainName, certificate: cognitoCustomDomain.certificate },
        });
        const hostedZone = route53.HostedZone.fromLookup(this, sid("CognitoAuthZone"), {
          domainName: cognitoCustomDomain.hostedZoneName,
        });
        new route53.CnameRecord(this, sid("CognitoAuthCname"), {
          zone: hostedZone,
          recordName: domainName,
          domainName: userPoolDomain.cloudFrontDomainName,
          ttl: cdk.Duration.minutes(5),
        });
      }
    } else {
      const userPoolDomain = userPool.addDomain("HostedUiDomain", {
        cognitoDomain: {
          // gen2 suffixes the prefix so it doesn't collide with gen1's retained domain.
          domainPrefix: `bookshelf-${cdk.Aws.ACCOUNT_ID}${idSuffix ? "-g2" : ""}`,
        },
      });
      hostedUiDomain = `${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`;
      hostedUiBaseUrl = userPoolDomain.baseUrl();
      hostedUiDomainRef = userPoolDomain.domainName;
    }

    return {
      userPoolId: userPool.userPoolId,
      spaClientId: appClient.userPoolClientId,
      mcpClientId: mcpClient.userPoolClientId,
      issuer: `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      hostedUiDomain,
      hostedUiBaseUrl,
      hostedUiDomainRef,
    };
  }
}
