import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { addApiGatewayCustomDomain } from "./api-gateway-domain";

export interface McpCustomDomainConfig {
  /** Canonical MCP hostname, e.g. "mcp.bookshelf.whoiskevinrich.com". */
  mcpHostname: string;
  /** Regional cert shared from ApiStack (covers the wildcard *.bookshelf.…). */
  certificate: acm.ICertificate;
  /** Route53 zone name for the A-alias record. */
  hostedZoneName: string;
}

export interface McpStackProps extends cdk.StackProps {
  userPoolId: string;
  userPoolIssuer: string;
  /** MCP OAuth app client ID — validates tokens issued by the MCP client, not the SPA */
  mcpClientId: string;
  /** Cognito Hosted UI base URL — served in OAuth discovery documents */
  hostedUiBaseUrl: string;
  /** Execute-API URL of the existing API stack — MCP proxies tool calls here */
  apiUrl: string;
  customDomain?: McpCustomDomainConfig;
}

export class McpStack extends cdk.Stack {
  /** HTTPS URL of the MCP API Gateway endpoint */
  readonly mcpUrl: string;
  /** Bare execute-api hostname — usable as a CloudFront origin if needed later */
  readonly executeApiDomain: string;

  constructor(scope: Construct, id: string, props: McpStackProps) {
    super(scope, id, props);

    // ── Lambda function ───────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, "McpLambdaLogGroup", {
      logGroupName: "/aws/lambda/bookshelf-mcp",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const mcpServerUrl = props.customDomain ? `https://${props.customDomain.mcpHostname}` : "";

    const mcpFunction = new lambda.Function(this, "McpFunction", {
      functionName: "bookshelf-mcp",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("../../apps/mcp/dist"),
      timeout: cdk.Duration.seconds(29),
      memorySize: 256,
      environment: {
        NODE_ENV: "production",
        COGNITO_ISSUER: props.userPoolIssuer,
        COGNITO_CLIENT_ID: props.mcpClientId,
        COGNITO_HOSTED_UI_BASE_URL: props.hostedUiBaseUrl,
        API_BASE_URL: props.apiUrl,
        MCP_SERVER_URL: mcpServerUrl,
      },
      logGroup,
    });

    // ── API Gateway HTTP API ──────────────────────────────────────────────
    //
    // No CORS — MCP clients are never browsers.
    const httpApi = new apigatewayv2.HttpApi(this, "HttpApi", {
      apiName: "bookshelf-mcp",
      description: "Bookshelf MCP Server",
    });

    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration(
        "LambdaIntegration",
        mcpFunction,
      ),
    });

    this.executeApiDomain = `${httpApi.apiId}.execute-api.${this.region}.amazonaws.com`;

    // ── Custom domain (prod) ──────────────────────────────────────────────
    //
    // Shares the wildcard regional cert created by ApiStack to avoid issuing a
    // second identical cert in the same region.
    if (props.customDomain) {
      const { mcpHostname, certificate, hostedZoneName } = props.customDomain;

      const regionalDomain = addApiGatewayCustomDomain(this, "Mcp", {
        api: httpApi,
        hostname: mcpHostname,
        certificate,
        hostedZoneName,
      });

      new cdk.CfnOutput(this, "McpCnameTargetOutput", {
        exportName: "BookshelfMcpCnameTarget",
        description: `API Gateway regional domain for ${mcpHostname}.`,
        value: regionalDomain,
      });
      new cdk.CfnOutput(this, "McpCustomUrlOutput", {
        exportName: "BookshelfMcpCustomUrl",
        value: `https://${mcpHostname}`,
      });
    }

    // ── Outputs ───────────────────────────────────────────────────────────
    this.mcpUrl = httpApi.apiEndpoint;

    new cdk.CfnOutput(this, "McpUrlOutput", {
      exportName: "BookshelfMcpUrl",
      value: httpApi.apiEndpoint,
    });
  }
}
