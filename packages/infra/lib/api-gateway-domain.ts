import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";

interface Props {
  api: apigatewayv2.HttpApi;
  hostname: string;
  certificate: acm.ICertificate;
  hostedZoneName: string;
}

/**
 * Attaches a custom domain to an HTTP API: DomainName → ApiMapping → Route53
 * A-alias record. Returns the regional domain name for use in CfnOutputs.
 */
export function addApiGatewayCustomDomain(
  scope: Construct,
  id: string,
  { api, hostname, certificate, hostedZoneName }: Props,
): string {
  const zone = route53.HostedZone.fromLookup(scope, `${id}Zone`, {
    domainName: hostedZoneName,
  });

  const domain = new apigatewayv2.DomainName(scope, `${id}DomainName`, {
    domainName: hostname,
    certificate,
  });

  new apigatewayv2.ApiMapping(scope, `${id}Mapping`, {
    api,
    domainName: domain,
    stage: api.defaultStage,
  });

  new route53.ARecord(scope, `${id}AliasRecord`, {
    zone,
    recordName: hostname,
    target: route53.RecordTarget.fromAlias(
      new route53Targets.ApiGatewayv2DomainProperties(
        domain.regionalDomainName,
        domain.regionalHostedZoneId,
      ),
    ),
  });

  return domain.regionalDomainName;
}
