// CountyLensData assertions (A-03 T017) against specs/003-walking-skeleton/contracts/storage.md:
// the CID-copy bucket, the OAC CloudFront distribution with origin path /ipfs, the cache and
// CORS response-headers policies, the conditional-write guard, the writer role, the private
// bench prefix outside the origin path, and the outputs + SSM mirrors. The infra half of
// A-03-TC-044 (the bucket refuses a PutObject without If-None-Match) is asserted here.
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { DataStack } from "../src/data-stack.js";
import { appUnderTest } from "./helpers.js";

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource?: unknown;
  Principal?: unknown;
  Condition?: Record<string, unknown>;
}
interface CfnResource {
  Type: string;
  Properties?: Record<string, unknown>;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
}

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function synthData(): {
  stack: DataStack;
  template: Template;
  resources: Record<string, CfnResource>;
} {
  // Same cdk.json context (feature flags, countylens:* keys) as `cdk synth`.
  const { stacks } = appUnderTest();
  const template = Template.fromStack(stacks.data);
  return {
    stack: stacks.data,
    template,
    resources: template.toJSON().Resources as Record<string, CfnResource>,
  };
}

const actionsOf = (s: Statement): string[] => (Array.isArray(s.Action) ? s.Action : [s.Action]);
const asList = (s: Statement): string[] => actionsOf(s);
const json = (v: unknown): string => JSON.stringify(v);

function bucketPolicyStatements(template: Template): Statement[] {
  const policies = template.findResources("AWS::S3::BucketPolicy");
  return Object.values(policies).flatMap(
    (p) =>
      (p.Properties as { PolicyDocument: { Statement: Statement[] } }).PolicyDocument.Statement ??
      [],
  );
}

function only<T>(record: Record<string, T>, label: string): [string, T] {
  const entries = Object.entries(record);
  expect(entries, label).toHaveLength(1);
  return entries[0] as [string, T];
}

describe("CountyLensData: CID-copy bucket (contracts/storage.md)", () => {
  const { stack, template } = synthData();

  it("is a DataStack with the public and private prefixes from the contract", () => {
    expect(stack).toBeInstanceOf(DataStack);
    expect(stack.publicPrefix).toBe("ipfs/");
    expect(stack.privateBenchPrefix).toBe("private/bench/");
  });

  it("has exactly one bucket: Block Public Access ×4, SSE-S3 (AES256), RETAIN, no auto-delete", () => {
    template.resourceCountIs("AWS::S3::Bucket", 1);
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
            Status: "Enabled",
          }),
        ]),
      },
    });
    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
    // No KMS key, no auto-delete custom resource, no Lambda of any kind in the Data stack.
    template.resourceCountIs("AWS::KMS::Key", 0);
    template.resourceCountIs("Custom::S3AutoDeleteObjects", 0);
    template.resourceCountIs("AWS::Lambda::Function", 0);
    const bucketProps = only(template.findResources("AWS::S3::Bucket"), "bucket")[1]
      .Properties as Record<string, unknown>;
    expect(
      bucketProps.BucketName,
      "bucket name is generated, read from the output",
    ).toBeUndefined();
  });

  it("enforces SSL: Deny s3:* when aws:SecureTransport is false", () => {
    const deny = bucketPolicyStatements(template).find(
      (s) =>
        s.Effect === "Deny" &&
        asList(s).includes("s3:*") &&
        json(s.Condition).includes('"aws:SecureTransport":"false"'),
    );
    expect(deny).toBeDefined();
    expect(deny?.Principal).toEqual({ AWS: "*" });
  });

  it("answers S3 CORS for GET/HEAD with Range and If-None-Match, exposing the range headers", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      CorsConfiguration: {
        CorsRules: [
          Match.objectLike({
            AllowedMethods: ["GET", "HEAD"],
            AllowedOrigins: ["*"],
            AllowedHeaders: ["Range", "If-None-Match"],
            ExposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length", "ETag"],
          }),
        ],
      },
    });
  });

  it("A-03-TC-044 (infra half): the bucket policy denies s3:PutObject on ipfs/* without s3:if-none-match", () => {
    const guard = bucketPolicyStatements(template).find(
      (s) =>
        s.Effect === "Deny" &&
        asList(s).length === 1 &&
        asList(s)[0] === "s3:PutObject" &&
        json(s.Condition) === json({ Null: { "s3:if-none-match": "true" } }),
    );
    expect(guard, "conditional-write guard statement").toBeDefined();
    expect(guard?.Principal).toEqual({ AWS: "*" });
    expect(json(guard?.Resource)).toContain("/ipfs/*");
    expect(json(guard?.Resource)).not.toContain("private");
  });

  it("grants CloudFront (OAC) read access scoped to this distribution only", () => {
    const oacRead = bucketPolicyStatements(template).find(
      (s) =>
        s.Effect === "Allow" &&
        asList(s).includes("s3:GetObject") &&
        json(s.Principal).includes("cloudfront.amazonaws.com"),
    );
    expect(oacRead).toBeDefined();
    expect(json(oacRead?.Condition)).toContain("AWS:SourceArn");
  });
});

describe("CountyLensData: CloudFront CID copy (OAC, origin path /ipfs)", () => {
  const { template } = synthData();

  it("has one distribution with OAC, origin path /ipfs, PriceClass_100 and no WAF", () => {
    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    template.hasResourceProperties("AWS::CloudFront::OriginAccessControl", {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: "s3",
        SigningBehavior: "always",
        SigningProtocol: "sigv4",
      }),
    });
    const [, dist] = only(template.findResources("AWS::CloudFront::Distribution"), "distribution");
    const config = (dist.Properties as { DistributionConfig: Record<string, unknown> })
      .DistributionConfig;
    expect(config.PriceClass).toBe("PriceClass_100");
    expect(config.Enabled).toBe(true);
    expect(config.WebACLId).toBeUndefined();
    expect(config.Aliases ?? []).toEqual([]);
    expect(config.ViewerCertificate).toBeUndefined();
    const origins = config.Origins as Record<string, unknown>[];
    expect(origins).toHaveLength(1);
    const origin = origins[0] as Record<string, unknown>;
    expect(origin.OriginPath).toBe("/ipfs");
    expect(origin.OriginAccessControlId).toBeDefined();
    expect(origin.S3OriginConfig).toEqual({ OriginAccessIdentity: "" });
    expect(config.CacheBehaviors, "no additional behaviour reaches outside /ipfs").toBeUndefined();
  });

  it("private/bench/* is outside the origin path and never served", () => {
    const { stack } = synthData();
    const originPath = `/${stack.publicPrefix.replace(/\/$/, "")}`;
    expect(originPath).toBe("/ipfs");
    expect(stack.privateBenchPrefix.startsWith(stack.publicPrefix)).toBe(false);
    expect(json(template.findResources("AWS::CloudFront::Distribution"))).not.toContain(
      "private/bench",
    );
  });

  it("default behaviour: HTTPS only, GET/HEAD/OPTIONS, no compression, CORS origin-request policy", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: "https-only",
          AllowedMethods: ["GET", "HEAD", "OPTIONS"],
          CachedMethods: ["GET", "HEAD", "OPTIONS"],
          Compress: false,
          CachePolicyId: Match.anyValue(),
          OriginRequestPolicyId: Match.anyValue(),
          ResponseHeadersPolicyId: Match.anyValue(),
        }),
      }),
    });
  });

  it("cache policy: default and max TTL 1 year, nothing in the cache key, no Accept-Encoding", () => {
    template.resourceCountIs("AWS::CloudFront::CachePolicy", 1);
    template.hasResourceProperties("AWS::CloudFront::CachePolicy", {
      CachePolicyConfig: Match.objectLike({
        DefaultTTL: ONE_YEAR_SECONDS,
        MaxTTL: ONE_YEAR_SECONDS,
        MinTTL: 0,
        ParametersInCacheKeyAndForwardedToOrigin: {
          CookiesConfig: { CookieBehavior: "none" },
          HeadersConfig: { HeaderBehavior: "none" },
          QueryStringsConfig: { QueryStringBehavior: "none" },
          EnableAcceptEncodingGzip: false,
          EnableAcceptEncodingBrotli: false,
        },
      }),
    });
  });

  it("caches a 404 (and the OAC 403 for a missing key) for only 10 s so a new CID appears quickly", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ErrorCachingMinTTL: 10 }),
          Match.objectLike({ ErrorCode: 404, ErrorCachingMinTTL: 10 }),
        ]),
      }),
    });
  });

  it("CORS response-headers policy exactly per the contract, origin override on, no Cache-Control stamped", () => {
    template.resourceCountIs("AWS::CloudFront::ResponseHeadersPolicy", 1);
    template.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: Match.objectLike({
        CorsConfig: {
          AccessControlAllowCredentials: false,
          AccessControlAllowHeaders: { Items: ["Range", "If-None-Match"] },
          AccessControlAllowMethods: { Items: ["GET", "HEAD", "OPTIONS"] },
          AccessControlAllowOrigins: { Items: ["*"] },
          AccessControlExposeHeaders: {
            Items: ["Content-Range", "Accept-Ranges", "Content-Length", "ETag"],
          },
          OriginOverride: true,
        },
      }),
    });
    // Cache-Control: public, max-age=31536000, immutable is an object header set by the uploader
    // (contract "Object headers"); a policy header would also stamp it on 403/404 responses.
    const [, policy] = only(
      template.findResources("AWS::CloudFront::ResponseHeadersPolicy"),
      "response headers policy",
    );
    expect(json(policy.Properties).toLowerCase()).not.toContain("cache-control");
  });
});

describe("CountyLensData: writer role, outputs and SSM mirrors", () => {
  const { template, resources } = synthData();

  it("CountyLensCidCopyWriter is assumable by account principals only and has no Delete/ACL action", () => {
    template.resourceCountIs("AWS::IAM::Role", 1);
    const [, role] = only(template.findResources("AWS::IAM::Role"), "writer role");
    const props = role.Properties as {
      RoleName: string;
      AssumeRolePolicyDocument: { Statement: Statement[] };
      Policies?: { PolicyDocument: { Statement: Statement[] } }[];
      ManagedPolicyArns?: unknown[];
    };
    expect(props.RoleName).toBe("CountyLensCidCopyWriter");
    expect(props.ManagedPolicyArns ?? []).toEqual([]);
    const trust = props.AssumeRolePolicyDocument.Statement;
    expect(trust).toHaveLength(1);
    expect(json(trust[0]?.Principal)).toMatch(/:iam::.*:root/);
    expect(json(trust[0]?.Principal)).not.toMatch(/Service|Federated/);

    const inline = (props.Policies ?? []).flatMap((p) => p.PolicyDocument.Statement);
    const attached = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (p) =>
        (p.Properties as { PolicyDocument: { Statement: Statement[] } }).PolicyDocument.Statement ??
        [],
    );
    const statements = [...inline, ...attached];
    expect(statements.length).toBeGreaterThan(0);
    const actions = statements.flatMap(asList);
    expect(actions).toContain("s3:PutObject");
    expect(actions).toContain("s3:GetObject");
    expect(actions.filter((a) => /delete|acl|\*/i.test(a))).toEqual([]);
    for (const s of statements) {
      expect(s.Effect).toBe("Allow");
      const resource = json(s.Resource);
      expect(resource).not.toContain("private");
      if (asList(s).includes("s3:PutObject")) expect(resource).toContain("/ipfs/*");
      if (asList(s).includes("s3:ListBucket")) {
        expect(json(s.Condition)).toContain('"s3:prefix"');
        expect(json(s.Condition)).toContain("ipfs/");
      }
    }
  });

  it("outputs CidCopyBucketName and CidCopyHost (CID_COPY_HOST) plus the writer role ARN and distribution id", () => {
    template.hasOutput("CidCopyBucketName", { Value: { Ref: Match.anyValue() } });
    template.hasOutput("CidCopyHost", {
      Description: Match.stringLikeRegexp("CID_COPY_HOST"),
      Value: { "Fn::GetAtt": [Match.anyValue(), "DomainName"] },
    });
    template.hasOutput("CidCopyWriterRoleArn", {
      Value: { "Fn::GetAtt": [Match.anyValue(), "Arn"] },
    });
    template.hasOutput("CidCopyDistributionId", { Value: { Ref: Match.anyValue() } });
  });

  it("mirrors the outputs to SSM String parameters under /countylens/cid-copy/", () => {
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/countylens/cid-copy/bucket",
      Type: "String",
      Value: { Ref: Match.anyValue() },
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/countylens/cid-copy/host",
      Type: "String",
    });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/countylens/cid-copy/writer-role-arn",
      Type: "String",
    });
    for (const p of Object.values(template.findResources("AWS::SSM::Parameter"))) {
      expect((p.Properties as { Tier?: unknown }).Tier ?? "Standard").toBe("Standard");
    }
  });

  it("tags the bucket, distribution, role and parameters with project_name=oracle-travis", () => {
    const taggable = Object.values(resources).filter((r) =>
      [
        "AWS::S3::Bucket",
        "AWS::CloudFront::Distribution",
        "AWS::IAM::Role",
        "AWS::SSM::Parameter",
      ].includes(r.Type),
    );
    expect(taggable.length).toBeGreaterThanOrEqual(6);
    for (const r of taggable) {
      expect(json(r.Properties?.Tags), r.Type).toContain("oracle-travis");
    }
  });
});
