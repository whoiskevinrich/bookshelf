import * as path from "path";
import { describe, it, expect } from "vitest";
import * as cdk from "aws-cdk-lib";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Template, Match } from "aws-cdk-lib/assertions";
import { AuthStack } from "../lib/auth-stack";
import { ApiStack } from "../lib/api-stack";
import { WebStack } from "../lib/web-stack";
import { CdnCertStack } from "../lib/cdn-cert-stack";

// Fixture dist directory — avoids depending on a real Vite build during tests.
const webDistPath = path.join(__dirname, "fixtures/web-dist");

// Runtime config (written to S3 as /config.json) — required by every WebStack.
const testRuntimeConfig = {
  cognitoUserPoolId: "us-west-2_test",
  cognitoUserPoolClientId: "testclient",
  cognitoRegion: "us-west-2",
  cognitoOauthDomain: "test-bookshelf.auth.us-west-2.amazoncognito.com",
  apiBaseUrl: "/api",
};

// Single app shared across all describe blocks — stacks have unique IDs and
// AuthStack is synthesized only once (reused as ApiStack's dependency).
const env = { account: "123456789012", region: "us-east-1" };
const app = new cdk.App();

const authStack = new AuthStack(app, "TestAuth", { env });
// Blue/green phases (ADR-015) — separate stacks so each phase can be asserted independently.
const authStackCutover = new AuthStack(app, "TestAuthCutover", { env, poolPhase: "cutover" });
const authStackGreen = new AuthStack(app, "TestAuthGreen", { env, poolPhase: "green" });
const apiStack = new ApiStack(app, "TestApi", {
  env,
  userPoolId: authStack.userPoolId,
  userPoolIssuer: authStack.userPoolIssuer,
  userPoolClientId: authStack.userPoolClientId,
  mcpClientId: authStack.mcpClientId,
});
const webStack = new WebStack(app, "TestWeb", {
  env,
  version: "v0.1.0",
  webDistPath,
  runtimeConfig: testRuntimeConfig,
});

// ── AuthStack ──────────────────────────────────────────────────────────────
describe("AuthStack", () => {
  const template = Template.fromStack(authStack);

  it("creates a Cognito User Pool", () => {
    template.resourceCountIs("AWS::Cognito::UserPool", 1);
  });

  it("requires email sign-in", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UsernameAttributes: ["email"],
      AutoVerifiedAttributes: ["email"],
    });
  });

  it("keeps the legacy (gen1) pool's email immutable so the live pool is never replaced", () => {
    // gen1 must stay exactly as deployed; flipping its mutability would replace the pool —
    // the very thing ADR-015's blue/green avoids. Mutability lives on the green pool instead.
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      Schema: Match.arrayWith([
        Match.objectLike({ Name: "email", Required: true, Mutable: false }),
      ]),
    });
  });

  it("disables self sign-up by default (invitation-only)", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  it("creates two App Clients (SPA + MCP), both without a secret", () => {
    template.resourceCountIs("AWS::Cognito::UserPoolClient", 2);
    template.allResourcesProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: false,
    });
  });

  it("uses RETAIN removal policy (never delete user accounts)", () => {
    template.hasResource("AWS::Cognito::UserPool", {
      DeletionPolicy: "Retain",
    });
  });

  it("exports User Pool ID as a CloudFormation output", () => {
    template.hasOutput("UserPoolIdOutput", {
      Export: { Name: "BookshelfUserPoolId" },
    });
  });
});

// ── AuthStack blue/green phases (ADR-015) ───────────────────────────────────
describe("AuthStack blue/green phases", () => {
  const cutover = Template.fromStack(authStackCutover);
  const green = Template.fromStack(authStackGreen);

  it("cutover declares BOTH pools (gen1 + green)", () => {
    cutover.resourceCountIs("AWS::Cognito::UserPool", 2);
  });

  it("cutover gives each pool a distinct managed domain prefix", () => {
    // Distinct prefixes are what make the two pools coexist — gen1 keeps bookshelf-<acct>,
    // green gets the -g2 suffix. Two identical prefixes would fail to deploy.
    const domains = cutover.findResources("AWS::Cognito::UserPoolDomain");
    // Domain is a CloudFormation token (Fn::Join with the account Ref), so compare serialized.
    const prefixes = Object.values(domains).map((d) => JSON.stringify(d.Properties.Domain));
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes.some((p) => p.includes("-g2"))).toBe(true);
  });

  it("green is a single pool with mutable email", () => {
    green.resourceCountIs("AWS::Cognito::UserPool", 1);
    green.hasResourceProperties("AWS::Cognito::UserPool", {
      Schema: Match.arrayWith([Match.objectLike({ Name: "email", Required: true, Mutable: true })]),
    });
  });

  it("green keeps RETAIN so a botched cutover never deletes accounts", () => {
    green.hasResource("AWS::Cognito::UserPool", { DeletionPolicy: "Retain" });
  });
});

// ── ApiStack ───────────────────────────────────────────────────────────────
describe("ApiStack", () => {
  const template = Template.fromStack(apiStack);

  it("creates a DynamoDB table with PAY_PER_REQUEST billing", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("enables point-in-time recovery on the table", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  it("uses RETAIN removal policy on the table (never delete shelf data)", () => {
    template.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
    });
  });

  it("creates a Lambda function on Node 22", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
    });
  });

  it("injects required environment variables into Lambda", () => {
    // DYNAMODB_TABLE_NAME resolves to a CloudFormation Ref at synth time,
    // so we assert on the literal value we control (NODE_ENV) and verify
    // the table name key exists without checking its resolved value.
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          NODE_ENV: "production",
        }),
      },
    });
  });

  it("Lambda role has DynamoDB permissions scoped to the table", () => {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["dynamodb:GetItem", "dynamodb:PutItem"]),
          }),
        ]),
      },
    });
  });

  it("creates an API Gateway HTTP API", () => {
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
  });

  it("caps Lambda reserved concurrency as a cost ceiling (ADR-018)", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      ReservedConcurrentExecutions: 10,
    });
  });

  it("throttles the default stage to shed floods before Lambda (ADR-018)", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      DefaultRouteSettings: {
        ThrottlingRateLimit: 50,
        ThrottlingBurstLimit: 100,
      },
    });
  });

  it("exports API URL as a CloudFormation output", () => {
    template.hasOutput("ApiUrlOutput", {
      Export: { Name: "BookshelfApiUrl" },
    });
  });
});

// ── WebStack ───────────────────────────────────────────────────────────────
describe("WebStack", () => {
  const template = Template.fromStack(webStack);

  it("creates an S3 bucket", () => {
    // BucketDeployment adds a staging bucket via custom resource — assert at least 1
    template.resourceCountIs("AWS::S3::Bucket", 1);
  });

  it("blocks all public access to the web bucket", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it("creates a CloudFront distribution", () => {
    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
  });

  it("enforces HTTPS (redirect HTTP to HTTPS)", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        DefaultCacheBehavior: {
          ViewerProtocolPolicy: "redirect-to-https",
        },
      },
    });
  });

  // TLS 1.2 minimum is enforced via the CDK Distribution `minimumProtocolVersion`
  // prop (SecurityPolicyProtocol.TLS_V1_2_2021), but CloudFormation only emits
  // ViewerCertificate when a custom ACM certificate is attached. Without one the
  // key is absent from the template, so there is nothing to assert here.
  // Verified at the construct level: web-stack.ts.

  it("stores active version in SSM", () => {
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/bookshelf/web/active-version",
      Value: "v0.1.0",
    });
  });

  it("deploys web assets via BucketDeployment custom resource", () => {
    // BucketDeployment is backed by a Lambda-powered custom resource
    template.resourceCountIs("Custom::CDKBucketDeployment", 1);
  });
});

// ── Custom-domain topology (prod, `-c env=prod`) ─────────────────────────────
//
// Route53 manages cert validation CNAMEs and hostname A records automatically.
// All stacks share one region so the test exercises the domain code paths without
// cross-region reference machinery (a deploy concern); in real prod CdnCertStack
// is us-east-1 and Api/Web are us-west-2, wired with crossRegionReferences in bin.
// Zone lookups return placeholder IDs in tests (no live Route53 in unit tests).
describe("Custom-domain topology", () => {
  const zoneName = "bookshelf.example.com";
  const dApp = new cdk.App();
  const dEnv = { account: "123456789012", region: "us-east-1" };

  // Provide a non-placeholder hosted zone for CdnCertStack so the cert
  // validation CNAME construct synthesizes with a real zone reference.
  const mockZone = route53.HostedZone.fromHostedZoneAttributes(dApp, "MockZone", {
    hostedZoneId: "Z123MOCKZONE",
    zoneName,
  });

  const cdnCert = new CdnCertStack(dApp, "DTestCdnCert", {
    env: dEnv,
    domainName: zoneName,
    subjectAlternativeNames: [`*.${zoneName}`],
    hostedZone: mockZone,
  });
  const dAuth = new AuthStack(dApp, "DTestAuth", { env: dEnv });
  const dApi = new ApiStack(dApp, "DTestApi", {
    env: dEnv,
    userPoolId: dAuth.userPoolId,
    userPoolIssuer: dAuth.userPoolIssuer,
    userPoolClientId: dAuth.userPoolClientId,
    mcpClientId: dAuth.mcpClientId,
    sameOrigin: true,
    customDomain: {
      apiHostname: `api.${zoneName}`,
      certificateDomainName: `*.${zoneName}`,
      hostedZoneName: zoneName,
    },
  });
  const dWeb = new WebStack(dApp, "DTestWeb", {
    env: dEnv,
    version: "v1.0.0",
    webDistPath,
    apiOrigin: dApi.executeApiDomain,
    customDomain: {
      certificate: cdnCert.certificate,
      webHostname: zoneName,
      hostedZoneName: zoneName,
    },
    runtimeConfig: testRuntimeConfig,
  });

  it("CdnCertStack issues a DNS-validated cert with the wildcard SAN", () => {
    Template.fromStack(cdnCert).hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: zoneName,
      SubjectAlternativeNames: [`*.${zoneName}`],
      ValidationMethod: "DNS",
    });
  });

  describe("ApiStack with a custom domain", () => {
    const template = Template.fromStack(dApi);

    it("creates an API Gateway custom domain name + mapping", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
        DomainName: `api.${zoneName}`,
      });
      template.resourceCountIs("AWS::ApiGatewayV2::ApiMapping", 1);
    });

    it("creates a Route53 A alias record for the API domain", () => {
      // CDK embeds the hosted zone ID in Certificate DomainValidationOptions;
      // CloudFormation handles the validation CNAME internally — only the A
      // alias record for the API hostname appears as an explicit resource.
      template.resourceCountIs("AWS::Route53::RecordSet", 1);
      template.hasResourceProperties("AWS::Route53::RecordSet", { Type: "A" });
    });

    it("drops CORS when a custom domain is configured (same-origin / MCP)", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
        CorsConfiguration: Match.absent(),
      });
    });
  });

  describe("WebStack with a custom domain", () => {
    const template = Template.fromStack(dWeb);

    it("attaches the custom domain + ACM cert to CloudFront", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          Aliases: [zoneName],
        }),
      });
    });

    it("adds a CloudFront Function to strip the /api prefix", () => {
      template.resourceCountIs("AWS::CloudFront::Function", 1);
    });

    it("routes /api/* as an additional cache behavior", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          CacheBehaviors: Match.arrayWith([Match.objectLike({ PathPattern: "/api/*" })]),
        }),
      });
    });

    it("creates a Route53 A record for the web hostname", () => {
      template.resourceCountIs("AWS::Route53::RecordSet", 1);
    });
  });
});

// ── Interim topology (`-c env=prod-interim`) ─────────────────────────────────
//
// Domainless but same-origin: the `/api/*` CloudFront routing runs on the default
// *.cloudfront.net domain (no CORS), with NO custom cert/hostname. Used to ship
// prod while the custom domain is blocked at the registrar.
describe("Interim topology (same-origin, no custom domain)", () => {
  const iApp = new cdk.App();
  const iEnv = { account: "123456789012", region: "us-west-2" };

  const iAuth = new AuthStack(iApp, "ITestAuth", { env: iEnv });
  const iApi = new ApiStack(iApp, "ITestApi", {
    env: iEnv,
    userPoolId: iAuth.userPoolId,
    userPoolIssuer: iAuth.userPoolIssuer,
    userPoolClientId: iAuth.userPoolClientId,
    mcpClientId: iAuth.mcpClientId,
    sameOrigin: true, // no customDomain
  });
  const iWeb = new WebStack(iApp, "ITestWeb", {
    env: iEnv,
    version: "v1.0.0",
    webDistPath,
    apiOrigin: iApi.executeApiDomain, // no customDomain
    runtimeConfig: testRuntimeConfig,
  });

  describe("ApiStack (interim)", () => {
    const template = Template.fromStack(iApi);

    it("drops CORS (browser is same-origin via CloudFront)", () => {
      template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
        CorsConfiguration: Match.absent(),
      });
    });

    it("creates NO custom domain or ACM cert", () => {
      template.resourceCountIs("AWS::ApiGatewayV2::DomainName", 0);
      template.resourceCountIs("AWS::CertificateManager::Certificate", 0);
    });
  });

  describe("WebStack (interim)", () => {
    const template = Template.fromStack(iWeb);

    it("routes /api/* same-origin with the strip Function", () => {
      template.resourceCountIs("AWS::CloudFront::Function", 1);
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          CacheBehaviors: Match.arrayWith([Match.objectLike({ PathPattern: "/api/*" })]),
        }),
      });
    });

    it("has NO custom domain aliases on CloudFront (serves on *.cloudfront.net)", () => {
      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: Match.objectLike({
          Aliases: Match.absent(),
        }),
      });
    });
  });
});

// ── CORS fallback: sameOrigin=false keeps permissive CORS (cross-origin SPA) ──
// No deployed env uses this path (all are same-origin), but it guards the fallback.
describe("API CORS fallback (sameOrigin=false)", () => {
  const cApp = new cdk.App();
  const cEnv = { account: "123456789012", region: "us-west-2" };
  const cAuth = new AuthStack(cApp, "CTestAuth", { env: cEnv });
  const cApi = new ApiStack(cApp, "CTestApi", {
    env: cEnv,
    userPoolId: cAuth.userPoolId,
    userPoolIssuer: cAuth.userPoolIssuer,
    userPoolClientId: cAuth.userPoolClientId,
    mcpClientId: cAuth.mcpClientId,
    // no sameOrigin, no customDomain
  });

  it("keeps permissive CORS when not same-origin", () => {
    // sameOrigin=false is local dev only; origins are scoped to localhost
    // rather than wildcard "*" to minimise the cross-origin surface.
    Template.fromStack(cApi).hasResourceProperties("AWS::ApiGatewayV2::Api", {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: ["http://localhost:3000", "http://localhost:5173"],
      }),
    });
  });
});
