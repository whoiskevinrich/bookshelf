import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";

export interface CdnCertStackProps extends cdk.StackProps {
  /** Primary cert domain, e.g. "bookshelf.whoiskevinrich.com". */
  domainName: string;
  /** Extra SANs, e.g. ["*.bookshelf.whoiskevinrich.com"]. */
  subjectAlternativeNames?: string[];
  /**
   * Route53 hosted zone for automated DNS validation (ADR-013).
   * Pass `DnsStack.hostedZone` — both stacks are in us-east-1, so this is a
   * plain same-region cross-stack reference. CDK writes the ACM validation
   * CNAME to the zone automatically; `cdk deploy` no longer blocks.
   */
  hostedZone: route53.IHostedZone;
}

/**
 * ACM certificate for the CloudFront distribution.
 *
 * MUST be in us-east-1 — CloudFront only accepts certs from that region, even
 * though the app's other stacks deploy to us-west-2.
 */
export class CdnCertStack extends cdk.Stack {
  /** Certificate consumed cross-region by WebStack (CloudFront, us-west-2 stack). */
  readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: CdnCertStackProps) {
    super(scope, id, { ...props, crossRegionReferences: true });

    this.certificate = new acm.Certificate(this, "Certificate", {
      domainName: props.domainName,
      ...(props.subjectAlternativeNames
        ? { subjectAlternativeNames: props.subjectAlternativeNames }
        : {}),
      validation: acm.CertificateValidation.fromDns(props.hostedZone),
    });

    new cdk.CfnOutput(this, "CertificateArnOutput", {
      value: this.certificate.certificateArn,
    });
  }
}
