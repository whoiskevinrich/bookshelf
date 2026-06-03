import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

export interface WebStackProps extends cdk.StackProps {
  /** Semver version string from CI, e.g. "v1.2.3". Used as the active S3 prefix. */
  version: string;
  /**
   * Absolute path to the built web app dist directory.
   * Defaults to `apps/web/dist` relative to the repo root.
   * Override in tests to point at a fixture directory.
   */
  webDistPath?: string;
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

    // ── CloudFront distribution ────────────────────────────────────────────
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "Bookshelf web SPA",
      defaultRootObject: "index.html",
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
    new s3deploy.BucketDeployment(this, "DeployWeb", {
      sources: [s3deploy.Source.asset(webDistPath)],
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

    // ── Outputs ────────────────────────────────────────────────────────────
    this.distributionUrl = `https://${distribution.distributionDomainName}`;

    new cdk.CfnOutput(this, "DistributionUrlOutput", {
      exportName: "BookshelfDistributionUrl",
      value: this.distributionUrl,
    });
  }
}
