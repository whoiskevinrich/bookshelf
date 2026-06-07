import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as logs from "aws-cdk-lib/aws-logs";
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
    // CORS: when `sameOrigin` (prod-interim + prod) the browser reaches the API
    // same-origin via CloudFront `/api/*` and MCP is non-browser, so no CORS is
    // needed and it is omitted. In dev the SPA calls the execute-api URL
    // cross-origin, so permissive CORS is kept. Resolves the historical
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
    // path rewrite (unlike the browser's CloudFront /api/* door). DNS lives at the
    // registrar (Hover): the regional cert is DNS-validated by a CNAME added there
    // by hand (the deploy blocks until it is), and the public hostname is a CNAME
    // → this custom domain's regional name. See ADR-008 /
    // docs/runbooks/prod-domain-setup.md.
    if (props.customDomain) {
      const apiCert = new acm.Certificate(this, "ApiCertificate", {
        domainName: props.customDomain.certificateDomainName,
        ...(props.customDomain.certificateSans
          ? { subjectAlternativeNames: props.customDomain.certificateSans }
          : {}),
        // No Route53 zone — add the validation CNAME manually at the registrar.
        validation: acm.CertificateValidation.fromDns(),
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

      // CNAME target to create at the registrar: api.<zone> → this value.
      new cdk.CfnOutput(this, "ApiCnameTargetOutput", {
        exportName: "BookshelfApiCnameTarget",
        description: `Create CNAME ${props.customDomain.apiHostname} → this value at the registrar`,
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
