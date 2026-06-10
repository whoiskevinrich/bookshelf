import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

/**
 * Custom-domain config for the web "door" (full prod only): CloudFront serves the
 * SPA at `webHostname` with the ACM cert. Independent of `apiOrigin` — the interim
 * topology runs the same-origin `/api/*` routing on the default `*.cloudfront.net`
 * domain without a custom hostname/cert. See ADR-008.
 */
export interface WebCustomDomainConfig {
  /** CloudFront cert (from CdnCertStack, us-east-1) covering webHostname. */
  certificate: acm.ICertificate;
  /** SPA hostname, e.g. "bookshelf.whoiskevinrich.com". */
  webHostname: string;
  /** Route53 zone name for the A-alias record pointing webHostname at CloudFront. */
  hostedZoneName: string;
}

export interface WebStackProps extends cdk.StackProps {
  /** Semver version string from CI, e.g. "v1.2.3". Used as the active S3 prefix. */
  version: string;
  /**
   * Absolute path to the built web app dist directory.
   * Defaults to `apps/web/dist` relative to the repo root.
   * Override in tests to point at a fixture directory.
   */
  webDistPath?: string;
  /**
   * Bare execute-api host of the API (no scheme/path). When set, CloudFront adds a
   * same-origin `/api/*` behavior (with the `/api`-strip Function) so the browser
   * never makes a cross-origin API call → no CORS. Set for `prod-interim` and
   * `prod`; omit for dev.
   */
  apiOrigin?: string;
  /** Custom domain (full prod): cert + alias hostname. Omit for dev and interim. */
  customDomain?: WebCustomDomainConfig;
  /**
   * Runtime config written to S3 as `/config.json` and fetched by the SPA at boot
   * (see `apps/web/src/lib/runtime-config.ts`) — so the bundle bakes in NO
   * environment values. Sourced from the Auth/API stacks' public readonly
   * properties; CDK tokens are resolved at deploy time by `Source.jsonData`.
   */
  runtimeConfig: {
    cognitoUserPoolId: string;
    cognitoUserPoolClientId: string;
    cognitoRegion: string;
    /** Hosted UI FQDN (no scheme) — used as Amplify oauth.domain. */
    cognitoOauthDomain: string;
    /** "/api" (same-origin) or the absolute execute-api URL (dev). */
    apiBaseUrl: string;
  };
}

export class WebStack extends cdk.Stack {
  /** CloudFront distribution URL */
  readonly distributionUrl: string;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const webDistPath = props.webDistPath ?? path.join(__dirname, "../../../apps/web/dist");

    // ── S3 bucket (static SPA assets) ─────────────────────────────────────
    //
    // Versioned deployment layout:
    //   s3://bookshelf-web/builds/v1.2.3/   ← active
    //   s3://bookshelf-web/builds/v1.2.2/   ← previous (for rollback)
    //
    // BucketDeployment syncs the built dist/ into the active prefix and
    // invalidates CloudFront. prune: false preserves previous prefixes.
    const bucket = new s3.Bucket(this, "WebBucket", {
      bucketName: `bookshelf-web-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // CloudFront OAC handles access
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false, // versioning handled by prefix, not S3 object versions
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          // Keep only the 10 most recent build prefixes by age
          // Builds older than 30 days are safe to remove (10 semver releases)
          prefix: "builds/",
          expiration: cdk.Duration.days(30),
          id: "expire-old-builds",
          enabled: true,
        },
      ],
    });

    // ── CloudFront Origin Access Control ──────────────────────────────────
    const oac = new cloudfront.S3OriginAccessControl(this, "OAC", {
      description: "Bookshelf web SPA OAC",
      signing: cloudfront.Signing.SIGV4_NO_OVERRIDE,
    });

    // ── Same-origin API door (prod) ────────────────────────────────────────
    //
    // CloudFront forwards `/api/*` to the API Gateway origin so the browser
    // calls the API same-origin (no CORS). A CloudFront Function strips the
    // `/api` prefix so Hono's existing `/v1/...` routes match unchanged. The
    // behavior is caching-disabled and forwards the Authorization header (via
    // ALL_VIEWER_EXCEPT_HOST_HEADER — Host is dropped so API Gateway accepts it).
    const apiBehavior: Record<string, cloudfront.BehaviorOptions> = {};
    if (props.apiOrigin) {
      const stripApiPrefix = new cloudfront.Function(this, "StripApiPrefix", {
        comment: "Strip the /api prefix before forwarding to the API origin",
        code: cloudfront.FunctionCode.fromInline(
          [
            "function handler(event) {",
            "  var req = event.request;",
            "  req.uri = req.uri.replace(/^\\/api/, '');",
            "  if (req.uri === '') { req.uri = '/'; }",
            "  return req;",
            "}",
          ].join("\n"),
        ),
      });

      apiBehavior["/api/*"] = {
        origin: new cloudfrontOrigins.HttpOrigin(props.apiOrigin),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        compress: true,
        functionAssociations: [
          {
            function: stripApiPrefix,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      };
    }

    // ── CloudFront distribution ────────────────────────────────────────────
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "Bookshelf web SPA",
      defaultRootObject: "index.html",
      ...(props.customDomain
        ? {
            domainNames: [props.customDomain.webHostname],
            certificate: props.customDomain.certificate,
          }
        : {}),
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(bucket, {
          originAccessControl: oac,
          // Route to the versioned prefix; updated on each deploy via BucketDeployment
          originPath: `/builds/${props.version}`,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      additionalBehaviors: apiBehavior,
      // SPA routing: all 404s → index.html so React Router handles the path
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
      ],
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // Grant CloudFront OAC read access to the bucket
    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowCloudFrontOAC",
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        actions: ["s3:GetObject"],
        resources: [bucket.arnForObjects("*")],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
          },
        },
      }),
    );

    // ── Web asset deployment ───────────────────────────────────────────────
    //
    // Uploads the built SPA to the versioned S3 prefix and invalidates
    // CloudFront — replacing the manual `aws s3 sync` + `create-invalidation`
    // CI steps. prune: false preserves previous prefixes for rollback.
    //
    // Give the BucketDeployment handler an explicit log group rather than the
    // CDK-managed default. With `@aws-cdk/aws-lambda:useCdkManagedLogGroup` on,
    // the default managed group is named `/aws/lambda/<functionName>` — the same
    // name the handler Lambda auto-created on its first run before the flag was
    // enabled, so CloudFormation rejects the change set ("LogGroup already
    // exists"). A dedicated group sidesteps the name collision entirely.
    const deployLogGroup = new logs.LogGroup(this, "DeployWebLogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new s3deploy.BucketDeployment(this, "DeployWeb", {
      logGroup: deployLogGroup,
      sources: [
        s3deploy.Source.asset(webDistPath),
        // Deploy-time runtime config the SPA fetches at boot (lib/runtime-config.ts).
        // Token values (Cognito IDs) are resolved here at deploy time.
        s3deploy.Source.jsonData("config.json", {
          cognito: {
            userPoolId: props.runtimeConfig.cognitoUserPoolId,
            userPoolClientId: props.runtimeConfig.cognitoUserPoolClientId,
            region: props.runtimeConfig.cognitoRegion,
            oauthDomain: props.runtimeConfig.cognitoOauthDomain,
          },
          apiBaseUrl: props.runtimeConfig.apiBaseUrl,
        }),
      ],
      destinationBucket: bucket,
      destinationKeyPrefix: `builds/${props.version}`,
      distribution,
      distributionPaths: ["/*"],
      prune: false,
      memoryLimit: 512,
    });

    // ── SSM Parameters ─────────────────────────────────────────────────────
    //
    // active-version: read by the rollback runbook to identify the live prefix
    // distribution-id: kept for manual operational use (runbook, ad-hoc invalidation)
    // bucket-name and distribution-id are no longer read by CI — BucketDeployment
    // handles sync and invalidation, and CloudFormation outputs cover anything else.
    new ssm.StringParameter(this, "ActiveVersionParam", {
      parameterName: "/bookshelf/web/active-version",
      stringValue: props.version,
      description: "Currently active web build version — update to roll back",
    });

    // ── Route53 alias record (prod) ───────────────────────────────────────
    if (props.customDomain) {
      const zone = route53.HostedZone.fromLookup(this, "HostedZone", {
        domainName: props.customDomain.hostedZoneName,
      });
      new route53.ARecord(this, "WebAliasRecord", {
        zone,
        recordName: props.customDomain.webHostname,
        target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
      });

      new cdk.CfnOutput(this, "WebCnameTargetOutput", {
        exportName: "BookshelfWebCnameTarget",
        value: distribution.distributionDomainName,
      });
    }

    // ── Outputs ────────────────────────────────────────────────────────────
    this.distributionUrl = `https://${distribution.distributionDomainName}`;

    new cdk.CfnOutput(this, "DistributionUrlOutput", {
      exportName: "BookshelfDistributionUrl",
      value: this.distributionUrl,
    });
    new cdk.CfnOutput(this, "DistributionIdOutput", {
      exportName: "BookshelfDistributionId",
      value: distribution.distributionId,
    });

    if (props.customDomain) {
      new cdk.CfnOutput(this, "WebCustomUrlOutput", {
        exportName: "BookshelfWebCustomUrl",
        value: `https://${props.customDomain.webHostname}`,
      });
    }
  }
}
