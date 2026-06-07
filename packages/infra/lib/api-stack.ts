import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";

/**
 * Custom API hostname config (full prod only) — the canonical `api.<app>...`
 * door for MCP / programmatic clients. Independent of `sameOrigin`: the interim
 * topology runs same-origin (no CORS) without a custom hostname. See ADR-008.
 */
export interface ApiCustomDomainConfig {
  /** Canonical API hostname, e.g. "api.bookshelf.whoiskevinrich.com". */
  apiHostname: string;
  /** Regional cert domain covering apiHostname, e.g. "*.bookshelf.whoiskevinrich.com". */
  certificateDomainName: string;
  /** Optional extra SANs for the regional cert. */
  certificateSans?: string[];
  /**
   * Route53 zone name for automated cert validation and alias record (ADR-013, Phase 2).
   * E.g. "bookshelf.whoiskevinrich.com". When set, CDK validates the regional cert
   * automatically via fromDns and creates an A-alias record for `apiHostname`.
   * Omit to fall back to manual DNS validation (Phase 1).
   */
  hostedZoneName?: string;
}

export interface ApiStackProps extends cdk.StackProps {
  userPoolId: string;
  userPoolIssuer: string;
  userPoolClientId: string;
  /**
   * When true, the browser reaches the API same-origin via CloudFront `/api/*`
   * (and MCP is non-browser), so **no CORS** is configured. When false/omitted
   * (dev), the SPA calls the execute-api URL cross-origin and permissive CORS is
   * kept. True for both the domainless `prod-interim` and full `prod`.
   */
  sameOrigin?: boolean;
  /** Custom API hostname (full prod). Omit for dev and the domainless interim. */
  customDomain?: ApiCustomDomainConfig;
}

export class ApiStack extends cdk.Stack {
  /** HTTPS URL of the API Gateway (raw execute-api endpoint) — consumed by WebStack */
  readonly apiUrl: string;
  /** Bare execute-api hostname (no scheme/path) — used as the CloudFront `/api` origin */
  readonly executeApiDomain: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // ── DynamoDB single table ──────────────────────────────────────────────
    //
    // Key design (from ADR-001 + core-shelf spec):
    //   PK: USER#<cognitoSub>  SK: SHELF#owned#<isbn>  → owned shelf entry
    //   PK: USER#<cognitoSub>  SK: SHELF#want#<isbn>   → want shelf entry
    //   PK: BOOK#<isbn>        SK: METADATA             → canonical book data
    const table = new dynamodb.Table(this, "Table", {
      tableName: "bookshelf",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // on-demand; ~$0 at hobby scale
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN, // never accidentally delete shelf data
    });

    // ── Lambda function (Hono API handler) ────────────────────────────────
    //
    // The built bundle lives at apps/api/dist/index.js (produced by esbuild).
    // Phase 1 placeholder: inline code returning 200 for all requests.
    // Phase 2 switches this to lambda.Code.fromAsset('../apps/api/dist').
    const logGroup = new logs.LogGroup(this, "ApiLambdaLogGroup", {
      logGroupName: "/aws/lambda/bookshelf-api",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const apiFunction = new lambda.Function(this, "ApiFunction", {
      functionName: "bookshelf-api",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("../../apps/api/dist"),
      timeout: cdk.Duration.seconds(29), // API GW max is 30s
      memorySize: 256,
      environment: {
        NODE_ENV: "production",
        DYNAMODB_TABLE_NAME: table.tableName,
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClientId,
        COGNITO_ISSUER: props.userPoolIssuer,
        // Resolved in lambda
        GOOGLE_BOOKS_API_KEY_SSM_NAME: "/bookshelf/google-books-api-key",
        // BOOK_PROVIDER defaults to 'google-books' inside the app
      },
      logGroup,
    });

    // Least-privilege DynamoDB access scoped to the single bookshelf table
    table.grantReadWriteData(apiFunction);

    // Allow Lambda to read (and decrypt) the Google Books API key from SSM
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/bookshelf/google-books-api-key`,
        ],
      }),
    );

    // ── API Gateway HTTP API ───────────────────────────────────────────────
    //
    // CORS: when `sameOrigin` (all deployed envs — dev, prod-interim, prod) the
    // browser reaches the API same-origin via CloudFront `/api/*` and MCP is
    // non-browser, so no CORS is configured. The fallback (sameOrigin false) keeps
    // permissive CORS for a cross-origin SPA. Resolves the historical
    // "tighten to CloudFront domain" TODO — see ADR-008.
    const httpApi = new apigatewayv2.HttpApi(this, "HttpApi", {
      apiName: "bookshelf-api",
      description: "Bookshelf REST API",
      ...(props.sameOrigin
        ? {}
        : {
            corsPreflight: {
              allowOrigins: ["*"],
              allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
              allowHeaders: ["Authorization", "Content-Type"],
              maxAge: cdk.Duration.days(1),
            },
          }),
    });

    const lambdaIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      "LambdaIntegration",
      apiFunction,
    );

    // Catch-all route — Hono handles routing internally
    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: lambdaIntegration,
    });

    // Bare execute-api host (no scheme/path) for use as the CloudFront `/api` origin.
    this.executeApiDomain = `${httpApi.apiId}.execute-api.${this.region}.amazonaws.com`;

    // ── Custom domain (prod) — canonical API door for MCP / programmatic clients ─
    //
    // api.<app>.<root> → API Gateway, serving the same Hono /v1 routes with no
    // path rewrite (unlike the browser's CloudFront /api/* door). See ADR-008.
    //
    // Phase 2 (ADR-013, hostedZoneName set): regional cert validates automatically
    // via fromDns and a Route53 A-alias record replaces the manual CNAME at the
    // DNS provider. Phase 1 fallback: cert validates manually; CNAME added by hand.
    if (props.customDomain) {
      // Look up the hosted zone for cert validation + alias record.
      // Requires BookshelfDns to be deployed first (ADR-013 bootstrap sequence).
      // Route53 is a global API — lookup succeeds from this us-west-2 stack.
      // Result cached in cdk.context.json after first successful synth.
      const certZone = props.customDomain.hostedZoneName
        ? route53.HostedZone.fromLookup(this, "ApiCertHostedZone", {
            domainName: props.customDomain.hostedZoneName,
          })
        : undefined;

      const apiCert = new acm.Certificate(this, "ApiCertificate", {
        domainName: props.customDomain.certificateDomainName,
        ...(props.customDomain.certificateSans
          ? { subjectAlternativeNames: props.customDomain.certificateSans }
          : {}),
        // Phase 2: CDK adds the validation CNAME automatically.
        // Phase 1: add the CNAME manually at the DNS provider (Cloudflare).
        validation: certZone
          ? acm.CertificateValidation.fromDns(certZone)
          : acm.CertificateValidation.fromDns(),
      });

      const apiDomainName = new apigatewayv2.DomainName(this, "ApiDomainName", {
        domainName: props.customDomain.apiHostname,
        certificate: apiCert,
      });

      new apigatewayv2.ApiMapping(this, "ApiMapping", {
        api: httpApi,
        domainName: apiDomainName,
        stage: httpApi.defaultStage,
      });

      // Phase 2: A-alias record in Route53 replaces the manual CNAME at Cloudflare.
      if (certZone) {
        new route53.ARecord(this, "ApiAliasRecord", {
          zone: certZone,
          recordName: props.customDomain.apiHostname,
          target: route53.RecordTarget.fromAlias(
            new route53Targets.ApiGatewayv2DomainProperties(
              apiDomainName.regionalDomainName,
              apiDomainName.regionalHostedZoneId,
            ),
          ),
        });
      }

      new cdk.CfnOutput(this, "ApiCnameTargetOutput", {
        exportName: "BookshelfApiCnameTarget",
        description: `API Gateway regional domain for ${props.customDomain.apiHostname}. Phase 1: create CNAME here at the DNS provider. Phase 2: managed by Route53 alias record.`,
        value: apiDomainName.regionalDomainName,
      });
      new cdk.CfnOutput(this, "ApiCustomUrlOutput", {
        exportName: "BookshelfApiCustomUrl",
        value: `https://${props.customDomain.apiHostname}`,
      });
    }

    // ── SSM Parameters ─────────────────────────────────────────────────────
    new ssm.StringParameter(this, "ApiUrlParam", {
      parameterName: "/bookshelf/api/url",
      stringValue: httpApi.apiEndpoint,
      description: "Bookshelf API Gateway URL",
    });

    // ── Outputs ────────────────────────────────────────────────────────────
    this.apiUrl = httpApi.apiEndpoint;

    new cdk.CfnOutput(this, "ApiUrlOutput", {
      exportName: "BookshelfApiUrl",
      value: httpApi.apiEndpoint,
    });
    new cdk.CfnOutput(this, "TableNameOutput", {
      exportName: "BookshelfTableName",
      value: table.tableName,
    });
    new cdk.CfnOutput(this, "LambdaFunctionNameOutput", {
      exportName: "BookshelfLambdaFunctionName",
      value: apiFunction.functionName,
    });
  }
}
