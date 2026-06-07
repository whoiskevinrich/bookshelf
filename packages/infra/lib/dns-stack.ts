import * as cdk from "aws-cdk-lib";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";

export interface DnsStackProps extends cdk.StackProps {
  /** App subtree root, e.g. "bookshelf.whoiskevinrich.com". */
  appSubdomain: string;
}

/**
 * Route53 public hosted zone for the app's subdomain.
 *
 * Part of the two-tier DNS architecture (ADR-013): Cloudflare owns the apex zone
 * and holds a single NS delegation record pointing `appSubdomain` at this hosted
 * zone.  CDK then manages all records under the subtree — cert validation CNAMEs,
 * CloudFront alias, API Gateway alias, and future service hosts (mcp., admin., …).
 *
 * MUST be in us-east-1 so CdnCertStack (also us-east-1) can receive the hosted
 * zone as a direct same-region cross-stack reference without cross-region machinery.
 *
 * Bootstrap (once per environment):
 *   1. cdk deploy BookshelfDns -c env=prod   → capture 4 NS values from output
 *   2. Cloudflare → DNS → add NS record      → appSubdomain → those 4 NS values
 *   3. Wait for propagation (~15 min – 2 h)
 *   4. cdk deploy --all -c env=prod          → fully automated from here on
 */
export class DnsStack extends cdk.Stack {
  /**
   * Hosted zone for the app subdomain.
   * Pass to CdnCertStack (same region) for automated cert validation.
   * For cross-region stacks (ApiStack, WebStack in us-west-2) pass
   * `appSubdomain` as a plain string and use HostedZone.fromLookup there.
   */
  readonly hostedZone: route53.IHostedZone;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    const zone = new route53.PublicHostedZone(this, "HostedZone", {
      zoneName: props.appSubdomain,
    });
    this.hostedZone = zone;

    // Copy these four NS values into a Cloudflare NS record to delegate the
    // subdomain from Cloudflare to Route53 (one-time manual step).
    new cdk.CfnOutput(this, "NameServers", {
      value: cdk.Fn.join(", ", zone.hostedZoneNameServers),
      description:
        "Route53 nameservers — add as NS record at Cloudflare to delegate the subdomain (one-time bootstrap)",
    });

    new cdk.CfnOutput(this, "HostedZoneId", {
      value: zone.hostedZoneId,
      description: "Route53 hosted zone ID",
    });
  }
}
