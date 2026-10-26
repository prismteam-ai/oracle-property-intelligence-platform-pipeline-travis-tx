// Private S3 bucket + CloudFront (OAC). /cid/* needs signed URLs (trusted key group);
// /harness/* is public and holds only the measurement page and the DuckDB-WASM bundle (no data).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import type { Construct } from "constructs";

export class CountyLensSpikeStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, "Data", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ["*"],
          allowedHeaders: ["Range", "If-None-Match", "If-Modified-Since"],
          exposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length", "ETag"],
          maxAge: 3600,
        },
      ],
    });

    const pem = readFileSync(fileURLToPath(new URL("../spike-cf-public.pem", import.meta.url)), "utf8");
    const publicKey = new cf.PublicKey(this, "SignerKey", { encodedKey: pem, comment: "countylens spike signer" });
    const keyGroup = new cf.KeyGroup(this, "SignerGroup", { items: [publicKey] });

    const origin = origins.S3BucketOrigin.withOriginAccessControl(bucket);
    const corsReq = cf.OriginRequestPolicy.CORS_S3_ORIGIN;
    // Pass the Origin header so S3 answers with CORS headers; cache key includes Origin via policy below.
    const cachePolicy = new cf.CachePolicy(this, "CidCache", {
      defaultTtl: Duration.days(1),
      maxTtl: Duration.days(365),
      minTtl: Duration.seconds(0),
      headerBehavior: cf.CacheHeaderBehavior.allowList("Origin"),
      queryStringBehavior: cf.CacheQueryStringBehavior.none(),
      cookieBehavior: cf.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: false,
      enableAcceptEncodingBrotli: false,
    });

    const dist = new cf.Distribution(this, "Cdn", {
      comment: "countylens-spike",
      priceClass: cf.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cf.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cf.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
        trustedKeyGroups: [keyGroup],
      },
      additionalBehaviors: {
        "/cid/*": {
          origin,
          viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cf.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachedMethods: cf.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          cachePolicy,
          originRequestPolicy: corsReq,
          responseHeadersPolicy: cf.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
          trustedKeyGroups: [keyGroup],
        },
        "/harness/*": {
          origin,
          viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cf.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: cf.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
        },
      },
    });

    new CfnOutput(this, "BucketName", { value: bucket.bucketName });
    new CfnOutput(this, "DistributionDomain", { value: dist.distributionDomainName });
    new CfnOutput(this, "DistributionId", { value: dist.distributionId });
    new CfnOutput(this, "KeyPairId", { value: publicKey.publicKeyId });
  }
}
