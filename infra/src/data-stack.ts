// CountyLensData (A-03 T019): the CID copy. One private S3 bucket holds only elephant-cli
// output under ipfs/<cid>; CloudFront serves it through an Origin Access Control with origin
// path /ipfs, so the private/bench/ prefix (Lambda proof, TC-NF-05) is never reachable. The
// bucket policy refuses any PutObject under ipfs/* that is not conditional (If-None-Match), so
// a published CID can never be overwritten (A3, P0-3). Contract: contracts/storage.md;
// decisions AD-02 (read path), AD-13 (no Route 53), AD-14 (no Secrets Manager), A7 (no WAF,
// no KMS CMK, no logging bucket: nothing bills while idle).
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  Validations,
} from "aws-cdk-lib";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { EXPLORE_INDEX_ROOT, LIVE_STATUS_KEY } from "./config.js";

/** Public keys: `ipfs/<cid>` only (table parts, CARs under their carCid, manifests). */
export const CID_COPY_PUBLIC_PREFIX = "ipfs/";
/** Private keys for the Lambda proof; outside the CloudFront origin path, deleted after the runs. */
export const CID_COPY_PRIVATE_BENCH_PREFIX = "private/bench/";
/** Writer role name; the PO's `assess-cid-writer` profile assumes it (no access keys). */
export const CID_COPY_WRITER_ROLE_NAME = "CountyLensCidCopyWriter";
/** SSM String parameters mirroring the outputs. */
export const CID_COPY_SSM_PREFIX = "/countylens/cid-copy";

const ONE_YEAR = Duration.days(365);
/** A miss (404, or the OAC 403 for a missing key) is cached briefly so a new CID shows up fast. */
const ERROR_TTL = Duration.seconds(10);
const CORS_ALLOWED_HEADERS = ["Range", "If-None-Match"];
const CORS_EXPOSED_HEADERS = ["Content-Range", "Accept-Ranges", "Content-Length", "ETag"];

export class DataStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly distribution: cf.Distribution;
  readonly writerRole: iam.Role;
  readonly publicPrefix = CID_COPY_PUBLIC_PREFIX;
  readonly privateBenchPrefix = CID_COPY_PRIVATE_BENCH_PREFIX;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, "CidCopy", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // ACLs disabled altogether: ownership is always the bucket owner, no object ACL exists.
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: "abort-incomplete-multipart-after-1-day",
          enabled: true,
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      // S3 answers preflights itself (CloudFront forwards them with the CORS-S3Origin policy);
      // the response-headers policy below then overrides the CORS headers on every response.
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ["*"],
          allowedHeaders: CORS_ALLOWED_HEADERS,
          exposedHeaders: CORS_EXPOSED_HEADERS,
          maxAge: 3600,
        },
      ],
    });
    Validations.of(this.bucket).acknowledge({
      id: "AwsSolutions-S1",
      reason:
        "Server access logging needs a second bucket that bills for storage while idle (A7, NFR-02). " +
        "The bucket holds only public, immutable elephant-cli output; request evidence comes from the Api access log.",
    });

    // Write guard (contract): S3 itself refuses a PutObject under ipfs/* without If-None-Match,
    // so a published CID is never overwritten even by an identity that may write.
    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "DenyUnconditionalPutOnPublishedCids",
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:PutObject"],
        resources: [this.bucket.arnForObjects(`${CID_COPY_PUBLIC_PREFIX}*`)],
        conditions: { Null: { "s3:if-none-match": "true" } },
      }),
    );

    // CloudFront: OAC, origin path /ipfs (private/bench/* is outside it), PriceClass_100, no WAF.
    const origin = origins.S3BucketOrigin.withOriginAccessControl(this.bucket, {
      originPath: `/${CID_COPY_PUBLIC_PREFIX.replace(/\/$/, "")}`,
      originAccessLevels: [cf.AccessLevel.READ],
    });
    const cachePolicy = new cf.CachePolicy(this, "CidCache", {
      comment: "CountyLens CID copy: immutable objects, 1-year TTL, nothing in the cache key",
      defaultTtl: ONE_YEAR,
      maxTtl: ONE_YEAR,
      minTtl: Duration.seconds(0),
      headerBehavior: cf.CacheHeaderBehavior.none(),
      queryStringBehavior: cf.CacheQueryStringBehavior.none(),
      cookieBehavior: cf.CacheCookieBehavior.none(),
      // Parquet and CAR bytes are read by Range; never recompress them.
      enableAcceptEncodingGzip: false,
      enableAcceptEncodingBrotli: false,
    });
    // CORS per the contract. Cache-Control (public, max-age=31536000, immutable) is NOT set here:
    // it is an object header written by the uploader, because a policy header would also be
    // stamped on 403/404 responses and let a browser cache a miss for a year.
    const corsHeaders = new cf.ResponseHeadersPolicy(this, "CidCors", {
      comment: "CountyLens CID copy: CORS for browser range reads (DuckDB-WASM)",
      corsBehavior: {
        accessControlAllowCredentials: false,
        accessControlAllowOrigins: ["*"],
        accessControlAllowMethods: ["GET", "HEAD", "OPTIONS"],
        accessControlAllowHeaders: CORS_ALLOWED_HEADERS,
        accessControlExposeHeaders: CORS_EXPOSED_HEADERS,
        accessControlMaxAge: Duration.hours(1),
        originOverride: true,
      },
    });
    this.distribution = new cf.Distribution(this, "CidCdn", {
      comment: "CountyLens CID copy: elephant-cli output by CID, public and immutable",
      priceClass: cf.PriceClass.PRICE_CLASS_100,
      httpVersion: cf.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cf.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cf.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: false,
        cachePolicy,
        originRequestPolicy: cf.OriginRequestPolicy.CORS_S3_ORIGIN,
        responseHeadersPolicy: corsHeaders,
      },
      errorResponses: [
        { httpStatus: 403, ttl: ERROR_TTL },
        { httpStatus: 404, ttl: ERROR_TTL },
      ],
    });
    Validations.of(this.distribution).acknowledge(
      {
        id: "AwsSolutions-CFR1",
        reason:
          "Public open data (elephant-cli output by CID) with no geographic restriction by design; " +
          "nothing in the bucket is private to a country or a user.",
      },
      {
        id: "AwsSolutions-CFR2",
        reason:
          "AWS WAF bills while idle and is banned by ARD P0-19 / constitution A7; the distribution serves " +
          "immutable public objects, and the HTTP API stage throttle protects the only compute.",
      },
      {
        id: "AwsSolutions-CFR3",
        reason:
          "CloudFront access logging needs a logging bucket that bills for storage while idle (A7, NFR-02). " +
          "The objects are public and immutable; request evidence comes from the Api access log (AM-03).",
      },
      {
        id: "AwsSolutions-CFR4",
        reason:
          "The distribution uses the default *.cloudfront.net certificate: no ACM certificate and no Route 53 " +
          "zone (AD-13, A7), so CloudFront fixes the viewer policy and MinimumProtocolVersion cannot be set. " +
          "Clients are the browser app and the API Lambda, both TLS 1.2+.",
      },
    );

    // Writer: account principals only, PutObject + GetObject under ipfs/*, no Delete, no ACL.
    const publishedObjects = this.bucket.arnForObjects(`${CID_COPY_PUBLIC_PREFIX}*`);
    this.writerRole = new iam.Role(this, "CidCopyWriter", {
      roleName: CID_COPY_WRITER_ROLE_NAME,
      description:
        "Uploads elephant-cli output to ipfs/<cid> with If-None-Match and ChecksumSHA256 " +
        "(assumed by the assess-cid-writer profile). No Delete, no ACL, no access keys.",
      assumedBy: new iam.AccountRootPrincipal(),
      inlinePolicies: {
        CidCopyWrite: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: "PutAndReadPublishedCids",
              actions: ["s3:PutObject", "s3:GetObject", "s3:GetObjectAttributes"],
              resources: [publishedObjects],
            }),
            new iam.PolicyStatement({
              // HeadObject answers 404 (not 403) for a missing key only with ListBucket.
              sid: "ListPublishedPrefixOnly",
              actions: ["s3:ListBucket"],
              resources: [this.bucket.bucketArn],
              conditions: { StringLike: { "s3:prefix": [`${CID_COPY_PUBLIC_PREFIX}*`] } },
            }),
            new iam.PolicyStatement({
              // resolveCidCopyBucket() (pipeline/publish/src/cid-copy.ts) reads this parameter
              // when CID_COPY_BUCKET isn't set explicitly; the role never had permission for it
              // (found 2026-10-24 running Run 1's CID-copy upload -- worked around with an
              // explicit env var at the time, fixed properly here).
              sid: "ReadOwnBucketParameter",
              actions: ["ssm:GetParameter"],
              resources: [
                Stack.of(this).formatArn({
                  service: "ssm",
                  resource: "parameter",
                  resourceName: `${CID_COPY_SSM_PREFIX.slice(1)}/bucket`,
                }),
              ],
            }),
          ],
        }),
      },
    });
    Validations.of(this.writerRole).acknowledge({
      id: `AwsSolutions-IAM5[Resource::<${this.getLogicalId(this.bucket.node.defaultChild as s3.CfnBucket)}.Arn>/ipfs/*]`,
      reason:
        "Objects are keyed by their content CID under ipfs/*, so the prefix wildcard is the exact boundary " +
        "of what may be written; the role has no Delete and no ACL action and the bucket policy denies any " +
        "PutObject without If-None-Match (contracts/storage.md write guard).",
    });

    new CfnOutput(this, "CidCopyBucketName", {
      value: this.bucket.bucketName,
      description: `CID-copy bucket (mirrored to SSM ${CID_COPY_SSM_PREFIX}/bucket)`,
    });
    new CfnOutput(this, "CidCopyHost", {
      value: this.distribution.distributionDomainName,
      description:
        "CID_COPY_HOST: CloudFront domain of the CID copy; copyUrl(cid) = https://<host>/<cid>",
    });
    new CfnOutput(this, "CidCopyWriterRoleArn", {
      value: this.writerRole.roleArn,
      description: "Role ARN for the assess-cid-writer profile (role_arn, source_profile = assess)",
    });
    new CfnOutput(this, "CidCopyDistributionId", {
      value: this.distribution.distributionId,
      description: "CloudFront distribution id of the CID copy",
    });

    const mirror = (name: string, value: string, description: string): void => {
      new ssm.StringParameter(this, `${name}Parameter`, {
        parameterName: `${CID_COPY_SSM_PREFIX}/${name}`,
        stringValue: value,
        description,
        tier: ssm.ParameterTier.STANDARD,
      });
    };
    mirror(
      "bucket",
      this.bucket.bucketName,
      "CID-copy bucket name (CountyLensData output CidCopyBucketName)",
    );
    mirror(
      "host",
      this.distribution.distributionDomainName,
      "CID_COPY_HOST (CountyLensData output CidCopyHost)",
    );
    mirror("writer-role-arn", this.writerRole.roleArn, "CountyLensCidCopyWriter role ARN");
  }

  /**
   * Read grant for the API Lambda (contract "Reader"): GetObject on ipfs/* and private/bench/*,
   * plus ListBucket on the bucket for keys under private/bench/ only (presignPrefix lists the bench
   * prefix). No listing of ipfs/: a GetObject on a missing ipfs/<cid> then answers 403, which
   * s3-read.ts maps to NOT_FOUND.
   */
  grantApiRead(grantee: iam.IGrantable): iam.Grant {
    const get = iam.Grant.addToPrincipal({
      grantee,
      actions: ["s3:GetObject"],
      resourceArns: [
        this.bucket.arnForObjects(`${CID_COPY_PUBLIC_PREFIX}*`),
        this.bucket.arnForObjects(`${CID_COPY_PRIVATE_BENCH_PREFIX}*`),
        // A-16 (AC-13, ADR-0001 amendment): the private per-run Explore index, built on the
        // laptop from published CIDs only; outside the CloudFront origin path like bench/.
        this.bucket.arnForObjects(`${EXPLORE_INDEX_ROOT}*`),
        // A-16 (AC-7): the bridge's status object, one exact key (read-only here).
        this.bucket.arnForObjects(LIVE_STATUS_KEY),
      ],
    });
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "ListBenchPrefixOnly",
        actions: ["s3:ListBucket"],
        resources: [this.bucket.bucketArn],
        conditions: { StringLike: { "s3:prefix": [`${CID_COPY_PRIVATE_BENCH_PREFIX}*`] } },
      }),
    );
    return get;
  }
}
