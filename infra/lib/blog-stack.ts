import * as path from "node:path";
import {
  Stack,
  StackProps,
  RemovalPolicy,
  Duration,
  CfnOutput,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { CertIssuedWaiter } from "./cert-issued-waiter";

export interface BlogStackProps extends StackProps {
  /** e.g. "johnewillmanv.com". When set with hostedZoneId/Name, attaches a custom domain. */
  readonly domainName?: string;
  readonly hostedZoneId?: string;
  readonly hostedZoneName?: string;
  /**
   * If provided, CloudFront uses this existing ACM cert ARN instead of
   * having CDK create one. Useful when the deployer's IAM principal lacks
   * route53:ChangeResourceRecordSets and CFN's auto-validation can't write
   * the DNS challenge. Cert must be in us-east-1.
   */
  readonly existingCertificateArn?: string;
}

export class BlogStack extends Stack {
  constructor(scope: Construct, id: string, props: BlogStackProps = {}) {
    super(scope, id, props);

    const { domainName, hostedZoneId, hostedZoneName, existingCertificateArn } =
      props;

    // Access-logs bucket. Holds CloudFront standard logs under "cloudfront/"
    // and S3 server access logs from the site bucket under "s3-site/".
    // BUCKET_OWNER_PREFERRED (not _ENFORCED) is required: CloudFront's standard
    // log delivery uses ACLs and silently no-ops if ACLs are disabled.
    const logsBucket = new s3.Bucket(this, "LogsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [
        {
          id: "expire-logs-90d",
          enabled: true,
          expiration: Duration.days(90),
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
    });

    // Private bucket — content is only reachable through CloudFront.
    const bucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: false,
      serverAccessLogsBucket: logsBucket,
      serverAccessLogsPrefix: "s3-site/",
    });

    // Optional: custom domain wiring
    let certificate: acm.ICertificate | undefined;
    let zone: route53.IHostedZone | undefined;
    let certWaiter: CertIssuedWaiter | undefined;

    if (domainName && hostedZoneId && hostedZoneName) {
      zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
        hostedZoneId,
        zoneName: hostedZoneName,
      });
      if (existingCertificateArn) {
        // Import a pre-issued cert (skips creation entirely; cert is assumed
        // already ISSUED so no waiter needed).
        certificate = acm.Certificate.fromCertificateArn(
          this,
          "Certificate",
          existingCertificateArn
        );
      } else {
        // Native acm.Certificate (supports keyAlgorithm) + custom waiter
        // construct that polls ACM until status=ISSUED. The native CFN
        // resource has a known race (aws-cdk#8401) where it marks itself
        // COMPLETE while still PENDING_VALIDATION; without the waiter,
        // CloudFront rejects the still-pending cert with a misleading
        // "doesn't exist" error. CloudFront's distribution.node.addDependency
        // on the waiter blocks the attach until validation truly completes.
        //
        // Using P-256 (not P-384) — CloudFront in this account rejects
        // ECDSA P-384 despite docs claiming support; P-256 works fine.
        const cert = new acm.Certificate(this, "Certificate", {
          domainName,
          subjectAlternativeNames: [`www.${domainName}`],
          validation: acm.CertificateValidation.fromDns(zone),
          keyAlgorithm: acm.KeyAlgorithm.EC_PRIME256V1,
        });
        certWaiter = new CertIssuedWaiter(this, "CertWaiter", {
          certificateArn: cert.certificateArn,
        });
        certificate = cert;
      }
    }

    // WAF (CLOUDFRONT scope — this stack must be in us-east-1).
    // Default action ALLOW (it's a public blog); rules block specific abuse.
    // If a managed-rule false-positive ever surfaces (e.g. on a future contact
    // form), move the offending sub-rule to count via the excludedRules option.
    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      name: `JwBlogWebAcl-${this.stackName}`,
      defaultAction: { allow: {} },
      scope: "CLOUDFRONT",
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "JwBlogWebAcl",
        sampledRequestsEnabled: true,
      },
      rules: [
        // Cheap IP-level filter first so dirty traffic short-circuits before
        // body/header inspection.
        {
          name: "AWSManagedRulesAmazonIpReputationList",
          priority: 0,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesAmazonIpReputationList",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "AmazonIpReputationList",
            sampledRequestsEnabled: true,
          },
        },
        {
          name: "AWSManagedRulesCommonRuleSet",
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesCommonRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "CommonRuleSet",
            sampledRequestsEnabled: true,
          },
        },
        {
          name: "AWSManagedRulesKnownBadInputsRuleSet",
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesKnownBadInputsRuleSet",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "KnownBadInputs",
            sampledRequestsEnabled: true,
          },
        },
        // Per-IP rate limit. 2000 req / 5-min is well above any real reader;
        // catches scrapers and dumb DoS without affecting humans.
        {
          name: "RateLimitPerIp",
          priority: 10,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: "IP",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "RateLimitPerIp",
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // Response headers: CSP + the standard security header set.
    // CSP allowlist:
    //   - 'self' for first-party assets
    //   - giscus.app for the comments embed (script + iframe + API calls)
    //   - github avatars/assets for the avatars Giscus renders
    //   - fonts.googleapis.com / fonts.gstatic.com for Inter + JetBrains Mono
    // 'unsafe-inline' on script-src / style-src is required for Astro inline
    // scripts (no-FOUC theme detect, theme toggle, Giscus theme sync) and
    // Astro's component-scoped <style> blocks. To upgrade to hash-based
    // protection later, enable Astro's experimental CSP feature.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://giscus.app",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: https://avatars.githubusercontent.com https://github.githubassets.com",
      "frame-src https://giscus.app",
      "connect-src 'self' https://api.github.com https://giscus.app",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; ");

    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      "SiteHeadersPolicy",
      {
        comment: "Security headers + CSP for the blog",
        securityHeadersBehavior: {
          contentSecurityPolicy: {
            contentSecurityPolicy: csp,
            override: true,
          },
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            referrerPolicy:
              cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            override: true,
          },
          strictTransportSecurity: {
            accessControlMaxAge: Duration.days(365),
            includeSubdomains: true,
            preload: false,
            override: true,
          },
          xssProtection: {
            protection: true,
            modeBlock: true,
            override: true,
          },
        },
      }
    );

    // CloudFront distribution. OAC is the modern replacement for OAI and gives
    // CloudFront-only access to the private bucket.
    const distribution = new cloudfront.Distribution(this, "SiteDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        responseHeadersPolicy,
      },
      defaultRootObject: "index.html",
      // Astro outputs pretty URLs as folders with index.html — CloudFront needs
      // a Function (or Lambda@Edge) to rewrite "/blog/foo/" to "/blog/foo/index.html".
      // The associated function below handles that.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 404,
          responsePagePath: "/404.html",
          ttl: Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: "/404.html",
          ttl: Duration.minutes(5),
        },
      ],
      domainNames: domainName ? [domainName, `www.${domainName}`] : undefined,
      certificate,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_3_2025,
      logBucket: logsBucket,
      logFilePrefix: "cloudfront/",
      logIncludesCookies: false,
      webAclId: webAcl.attrArn,
    });

    // Block CloudFront's create/update on the cert actually being ISSUED, not
    // just CFN's premature COMPLETE on the cert resource. No-op when the cert
    // was imported (existingCertificateArn) since imported certs are already
    // ISSUED.
    if (certWaiter) {
      distribution.node.addDependency(certWaiter);
    }

    // CloudFront Function: rewrite "/path/" -> "/path/index.html" so directory
    // URLs resolve to Astro's generated index files.
    const rewriteFn = new cloudfront.Function(this, "RewriteUrlsFn", {
      code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          var uri = request.uri;
          if (uri.endsWith('/')) {
            request.uri = uri + 'index.html';
          } else if (!uri.includes('.')) {
            request.uri = uri + '/index.html';
          }
          return request;
        }
      `),
    });

    const cfnDist = distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDist.addPropertyOverride(
      "DistributionConfig.DefaultCacheBehavior.FunctionAssociations",
      [
        {
          EventType: "viewer-request",
          FunctionARN: rewriteFn.functionArn,
        },
      ]
    );

    // Upload the built site, invalidating all paths so the new content is live.
    new s3deploy.BucketDeployment(this, "DeploySite", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "..", "..", "dist"))],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ["/*"],
      memoryLimit: 512,
    });

    // Route53 alias records for the custom domain
    if (zone && domainName) {
      new route53.ARecord(this, "AliasRecord", {
        zone,
        recordName: domainName,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(distribution)
        ),
      });
      new route53.ARecord(this, "WwwAliasRecord", {
        zone,
        recordName: `www.${domainName}`,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(distribution)
        ),
      });
    }

    new CfnOutput(this, "BucketName", { value: bucket.bucketName });
    new CfnOutput(this, "LogsBucketName", { value: logsBucket.bucketName });
    new CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
    });
    new CfnOutput(this, "DistributionDomain", {
      value: distribution.distributionDomainName,
    });
    new CfnOutput(this, "WebAclArn", { value: webAcl.attrArn });
    if (domainName) {
      new CfnOutput(this, "SiteUrl", { value: `https://${domainName}` });
    }
  }
}
