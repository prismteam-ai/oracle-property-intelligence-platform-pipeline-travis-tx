// CountyLensCert (A-03 T043): only the Amplify custom-domain association for
// countylens.aldarraj.com (agent-design metagross § 2–3, research R-09). Amplify issues and
// renews the certificate itself (Amplify-managed, the default when certificateSettings is
// omitted), so there is no ACM certificate and no
// Route 53 zone (AD-13: DNS stays at Namecheap; the PO adds the two CNAMEs from the outputs,
// ✋ A-4). Deployed last (ARD § 16 AM-02) because it needs the Web app id and branch, and kept
// apart from CountyLensWeb so a DNS wait can only ever stall this stack (plan risk R4).
//
// The domain is the sub-domain itself with an empty prefix, never the root aldarraj.com: a root
// domain can belong to one Amplify app only, and Task B needs its own sub-domain on it.
import { Annotations, CfnOutput, Stack, type StackProps, Validations } from "aws-cdk-lib";
import * as amplify from "aws-cdk-lib/aws-amplify";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

/** The hosted runtime name (PUBLISHING.md § 1.3, ARD § 9); `*.amplifyapp.com` is the fallback. */
export const COUNTYLENS_DOMAIN_NAME = "countylens.aldarraj.com";
/** SSM String parameters mirroring the outputs. */
export const DOMAIN_SSM_PREFIX = "/countylens/domain";

export const CERT_WEB_NOT_WIRED_WARNING =
  "CountyLensCert: the Web app is not wired (props.web), so no AWS::Amplify::Domain is created; " +
  "pass { appId: web.appId, branchName: web.productionBranchName } in src/app.ts before deploying";

export interface CertStackProps extends StackProps {
  /** From CountyLensWeb: the Amplify app id and the branch the bare sub-domain maps to. */
  readonly web?: { readonly appId: string; readonly branchName: string };
}

export class CertStack extends Stack {
  readonly domainName = COUNTYLENS_DOMAIN_NAME;
  /** Set when the Web app is wired. */
  readonly domain?: amplify.CfnDomain;

  constructor(scope: Construct, id: string, props: CertStackProps) {
    super(scope, id, props);

    if (props.web === undefined) {
      Annotations.of(this).addWarningV2(
        "countylens:cert:web-not-wired",
        CERT_WEB_NOT_WIRED_WARNING,
      );
      // An empty template is this stack's defined "not wired" state; the warning above is the gate.
      Validations.of(this).acknowledge({
        id: "CloudFormation-Validate::F0001",
        reason: CERT_WEB_NOT_WIRED_WARNING,
      });
      return;
    }

    this.domain = new amplify.CfnDomain(this, "Domain", {
      appId: props.web.appId,
      domainName: COUNTYLENS_DOMAIN_NAME,
      // prefix '' = the domain itself → the production branch. Nothing else is mapped.
      subDomainSettings: [{ prefix: "", branchName: props.web.branchName }],
      // No certificateSettings: omitted means an Amplify-managed certificate (the default).
      // Setting it, even to { certificateType: "AMPLIFY_MANAGED" }, failed the 2026-10-21 deploy
      // with "A certificate ARN must be provided for a custom certificate".
      // Previews stay on *.amplifyapp.com: no automatic sub-domains, so no DNS role (AD-13).
      enableAutoSubDomain: false,
    });

    new CfnOutput(this, "HostedUrl", {
      value: `https://${COUNTYLENS_DOMAIN_NAME}`,
      description: "The hosted runtime once DomainStatus is AVAILABLE (FR-010 names the URL used)",
    });
    new CfnOutput(this, "DomainStatus", {
      value: this.domain.attrDomainStatus,
      description:
        "Amplify domain status; PENDING_VERIFICATION until the Namecheap CNAMEs exist, then AVAILABLE",
    });
    new CfnOutput(this, "CertificateVerificationRecord", {
      value: this.domain.attrCertificateRecord,
      description:
        "First Namecheap CNAME (certificate validation). The second, countylens → the Amplify CloudFront " +
        "domain, comes from `aws amplify get-domain-association` (subDomains[].dnsRecord).",
    });

    new ssm.StringParameter(this, "DomainNameParameter", {
      parameterName: `${DOMAIN_SSM_PREFIX}/name`,
      stringValue: COUNTYLENS_DOMAIN_NAME,
      description: "Custom domain of the hosted UI (CountyLensCert output HostedUrl)",
      tier: ssm.ParameterTier.STANDARD,
    });
  }
}
