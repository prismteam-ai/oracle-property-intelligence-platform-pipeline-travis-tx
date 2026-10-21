import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import {
  AllowedMethods,
  CacheCookieBehavior,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  OriginRequestPolicy,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import type { TravisConfig } from './config.js';
import { pinLambdaLogGroups } from './logs.js';

export interface TravisWebProps extends StackProps {
  config: TravisConfig;
  /** apps/explorer/dist (or a placeholder directory while the explorer is not built). */
  explorerDistDirectory: string;
}

/**
 * Viewer-request function: single-page routing for the explorer only. It is attached to the default behavior, never to
 * `/tables/*`, and there is no distribution-wide error response, so a missing Parquet part stays a 403/404.
 */
export const SPA_ROUTER_CODE = `
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var last = uri.substring(uri.lastIndexOf('/') + 1);
  if (uri.indexOf('/tables/') === 0) return request;
  if (last.indexOf('.') === -1) request.uri = '/index.html';
  return request;
}
`;

export class TravisWeb extends Stack {
  constructor(scope: Construct, id: string, props: TravisWebProps) {
    super(scope, id, { ...props, terminationProtection: true });
    const { config } = props;
    Tags.of(this).add('project_name', config.projectName);

    const privateBucket = {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    } as const;

    const explorerBucket = new Bucket(this, 'ExplorerStore', privateBucket);
    const mirrorBucket = new Bucket(this, 'MirrorStore', {
      ...privateBucket,
      lifecycleRules: [
        { id: 'abort-incomplete-multipart', abortIncompleteMultipartUploadAfter: Duration.days(7) },
      ],
      // Belt and braces for the preflight: S3 answers OPTIONS itself when CloudFront forwards it.
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [HttpMethods.GET, HttpMethods.HEAD],
          allowedHeaders: ['Range', 'If-Match', 'If-None-Match'],
          exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'ETag'],
          maxAge: 86400,
        },
      ],
    });

    const spaRouter = new CloudFrontFunction(this, 'SpaRouter', {
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromInline(SPA_ROUTER_CODE),
      comment: 'SPA routing for the explorer; never applied to /tables/*',
    });

    const tablesHeaders = new ResponseHeadersPolicy(this, 'TablesHeaders', {
      comment: 'Mirror: cross-origin Range reads for DuckDB-WASM, immutable caching',
      corsBehavior: {
        accessControlAllowOrigins: ['*'],
        accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
        accessControlAllowHeaders: ['Range', 'If-Match', 'If-None-Match'],
        accessControlExposeHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'ETag'],
        accessControlAllowCredentials: false,
        accessControlMaxAge: Duration.days(1),
        originOverride: true,
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Cache-Control', value: 'public, max-age=31536000, immutable', override: true },
        ],
      },
    });

    const tablesCache = new CachePolicy(this, 'TablesCache', {
      comment: 'Immutable mirror objects; compression off so byte ranges stay exact',
      defaultTtl: Duration.days(365),
      minTtl: Duration.days(365),
      maxTtl: Duration.days(365),
      enableAcceptEncodingGzip: false,
      enableAcceptEncodingBrotli: false,
      headerBehavior: CacheHeaderBehavior.none(),
      cookieBehavior: CacheCookieBehavior.none(),
      queryStringBehavior: CacheQueryStringBehavior.none(),
    });

    const distribution = new Distribution(this, 'Distribution', {
      comment: 'Travis explorer and CID-keyed Parquet mirror',
      defaultRootObject: 'index.html',
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(explorerBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        responseHeadersPolicy: new ResponseHeadersPolicy(this, 'ExplorerHeaders', {
          securityHeadersBehavior: {
            contentTypeOptions: { override: true },
            frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
            strictTransportSecurity: {
              accessControlMaxAge: Duration.days(365),
              includeSubdomains: true,
              override: true,
            },
            referrerPolicy: {
              referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
              override: true,
            },
          },
        }),
        functionAssociations: [
          { function: spaRouter, eventType: FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        '/tables/*': {
          origin: S3BucketOrigin.withOriginAccessControl(mirrorBucket),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: tablesCache,
          originRequestPolicy: OriginRequestPolicy.CORS_S3_ORIGIN,
          responseHeadersPolicy: tablesHeaders,
          compress: false,
        },
      },
    });

    // Explorer files. Only /index.html is invalidated: every other asset has a content-hashed name.
    const explorerDeployment = new BucketDeployment(this, 'ExplorerDeployment', {
      sources: [Source.asset(props.explorerDistDirectory)],
      destinationBucket: explorerBucket,
      distribution,
      distributionPaths: ['/index.html'],
      prune: true,
    });
    // Explicit content type for the self-hosted DuckDB-WASM binaries, whatever the build host's MIME table says.
    const wasmDeployment = new BucketDeployment(this, 'WasmDeployment', {
      sources: [Source.asset(props.explorerDistDirectory)],
      destinationBucket: explorerBucket,
      exclude: ['*'],
      include: ['*.wasm'],
      contentType: 'application/wasm',
      prune: false,
    });
    wasmDeployment.node.addDependency(explorerDeployment);

    new CfnOutput(this, 'ExplorerUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'MirrorBucket', { value: mirrorBucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });

    pinLambdaLogGroups(this);
  }
}
