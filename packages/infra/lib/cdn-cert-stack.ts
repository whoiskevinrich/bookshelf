import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Construct } from "constructs";

export interface CdnCertStackProps extends cdk.StackProps {
  /** Primary cert domain, e.g. "bookshelf.whoiskevinrich.com". */
  domainName: string;
  /** Extra SANs, e.g. ["*.bookshelf.whoiskevinrich.com"]. */
  subjectAlternativeNames?: string[];
}

/**
 * ACM certificate for the CloudFront distribution.
 *
 * MUST be in us-east-1 — CloudFront only accepts certs from that region, even
 * though the app's other stacks run in us-west-2.
 *
 * DNS for the domain lives at the registrar (Hover), which does not support the
 * NS records needed to delegate a subtree to Route53 (see ADR-008). So the cert
 * uses **manual** DNS validation: `cdk deploy` of this stack blocks in
 * CREATE_IN_PROGRESS until the ACM validation CNAME is added at the registrar,
 * then completes. The validation record persists and ACM reuses it for renewal.
 * See docs/runbooks/prod-domain-setup.md.
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
      // No Route53 zone — add the validation CNAME(s) manually at the registrar.
      validation: acm.CertificateValidation.fromDns(),
    });

    new cdk.CfnOutput(this, "CertificateArnOutput", {
      value: this.certificate.certificateArn,
    });
  }
}
