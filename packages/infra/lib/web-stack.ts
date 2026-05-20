import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface WebStackProps extends cdk.StackProps {
  /** Semver version string from CI, e.g. "v1.2.3". Used as the active S3 prefix. */
  version: string;
}

export class WebStack extends cdk.Stack {
  /** CloudFront distribution URL */
  readonly distributionUrl: string;
  readonly distributionId: string;
  readonly bucketName: string;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    // ── S3 bucket (static SPA assets) ─────────────────────────────────────
    //
    // Versioned deployment layout:
    //   s3://bookshelf-web/builds/v1.2.3/   ← active
    //   s3://bookshelf-web/builds/v1.2.2/   ← previous (for rollback)
    //
    // The active version prefix is stored in SSM at /bookshelf/web/active-version.
    // The deploy pipeline syncs the new build then updates SSM + invalidates CF.
    const bucket = new s3.Bucket(this, 'WebBucket', {
      bucketName: `bookshelf-web-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // CloudFront OAC handles access
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false, // versioning handled by prefix, not S3 object versions
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          // Keep only the 10 most recent build prefixes by age
          // Builds older than 30 days are safe to remove (10 semver releases)
          prefix: 'builds/',
          expiration: cdk.Duration.days(30),
          id: 'expire-old-builds',
          enabled: true,
        },
      ],
    });

    // ── CloudFront Origin Access Control ──────────────────────────────────
    const oac = new cloudfront.S3OriginAccessControl(this, 'OAC', {
      description: 'Bookshelf web SPA OAC',
      signing: cloudfront.Signing.SIGV4_NO_OVERRIDE,
    });

    // ── CloudFront distribution ────────────────────────────────────────────
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Bookshelf web SPA',
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(bucket, {
          originAccessControl: oac,
          // Route to the versioned prefix; updated in CI via SSM + CF invalidation
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
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // Grant CloudFront OAC read access to the bucket
    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudFrontOAC',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [bucket.arnForObjects('*')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
          },
        },
      })
    );

    // ── SSM Parameters (read by rollback runbook + CI scripts) ────────────
    new ssm.StringParameter(this, 'ActiveVersionParam', {
      parameterName: '/bookshelf/web/active-version',
      stringValue: props.version,
      description: 'Currently active web build version — update to roll back',
    });
    new ssm.StringParameter(this, 'BucketNameParam', {
      parameterName: '/bookshelf/web/bucket-name',
      stringValue: bucket.bucketName,
      description: 'Bookshelf web S3 bucket name',
    });
    new ssm.StringParameter(this, 'DistributionIdParam', {
      parameterName: '/bookshelf/web/distribution-id',
      stringValue: distribution.distributionId,
      description: 'Bookshelf CloudFront distribution ID',
    });

    // ── Outputs ────────────────────────────────────────────────────────────
    this.distributionUrl = `https://${distribution.distributionDomainName}`;
    this.distributionId = distribution.distributionId;
    this.bucketName = bucket.bucketName;

    new cdk.CfnOutput(this, 'DistributionUrlOutput', {
      exportName: 'BookshelfDistributionUrl',
      value: this.distributionUrl,
    });
    new cdk.CfnOutput(this, 'DistributionIdOutput', {
      exportName: 'BookshelfDistributionId',
      value: distribution.distributionId,
      description: 'Required for CI invalidations and rollback runbook',
    });
    new cdk.CfnOutput(this, 'BucketNameOutput', {
      exportName: 'BookshelfBucketName',
      value: bucket.bucketName,
    });
  }
}
