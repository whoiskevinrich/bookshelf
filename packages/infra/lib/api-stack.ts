import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { addApiGatewayCustomDomain } from "./api-gateway-domain";

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
  /** Route53 zone name for cert validation and API Gateway A-alias record. */
  hostedZoneName: string;
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
  /** Regional ACM cert covering `certificateDomainName` — shared with McpStack. */
  readonly regionalCertificate?: acm.Certificate;

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

    // Allow Lambda to delete users from Cognito (account deletion endpoint)
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:AdminDeleteUser"],
        resources: [
          `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${props.userPoolId}`,
        ],
      }),
    );

    // ── API Gateway HTTP API ───────────────────────────────────────────────
    //
    // CORS: when `sameOrigin` (all deployed envs) the browser reaches the API
    // same-origin via CloudFront `/api/*` — no CORS needed. The false path keeps
    // permissive CORS for a cross-origin SPA (local dev only). See ADR-008.
    const httpApi = new apigatewayv2.HttpApi(this, "HttpApi", {
      apiName: "bookshelf-api",
      description: "Bookshelf REST API",
      ...(props.sameOrigin
        ? {}
        : {
            corsPreflight: {
              allowOrigins: ["http://localhost:3000", "http://localhost:5173"],
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

    // ── Custom domain (prod) ───────────────────────────────────────────────
    //
    // api.<app>.<root> → API Gateway, serving the same Hono /v1 routes with no
    // path rewrite (unlike the browser's CloudFront /api/* door). See ADR-008.
    // The regional cert is exposed as `regionalCertificate` so McpStack can share
    // it rather than issuing a second identical wildcard cert.
    if (props.customDomain) {
      const { apiHostname, certificateDomainName, hostedZoneName } = props.customDomain;

      const certZone = route53.HostedZone.fromLookup(this, "ApiCertZone", {
        domainName: hostedZoneName,
      });
      const cert = new acm.Certificate(this, "ApiCertificate", {
        domainName: certificateDomainName,
        validation: acm.CertificateValidation.fromDns(certZone),
      });
      this.regionalCertificate = cert;

      const regionalDomain = addApiGatewayCustomDomain(this, "Api", {
        api: httpApi,
        hostname: apiHostname,
        certificate: cert,
        hostedZoneName,
      });

      new cdk.CfnOutput(this, "ApiCnameTargetOutput", {
        exportName: "BookshelfApiCnameTarget",
        description: `API Gateway regional domain for ${apiHostname}.`,
        value: regionalDomain,
      });
      new cdk.CfnOutput(this, "ApiCustomUrlOutput", {
        exportName: "BookshelfApiCustomUrl",
        value: `https://${apiHostname}`,
      });
    }

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
