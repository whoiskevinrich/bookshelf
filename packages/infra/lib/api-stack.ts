import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

export interface ApiStackProps extends cdk.StackProps {
  userPoolId: string;
  userPoolIssuer: string;
  userPoolClientId: string;
}

export class ApiStack extends cdk.Stack {
  /** HTTPS URL of the API Gateway — consumed by WebStack */
  readonly apiUrl: string;

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
    const httpApi = new apigatewayv2.HttpApi(this, "HttpApi", {
      apiName: "bookshelf-api",
      description: "Bookshelf REST API",
      corsPreflight: {
        allowOrigins: ["*"], // tightened to CloudFront domain after web deploy
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ["Authorization", "Content-Type"],
        maxAge: cdk.Duration.days(1),
      },
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
