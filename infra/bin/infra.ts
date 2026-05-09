#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { BlogStack } from "../lib/blog-stack";

const app = new cdk.App();

new BlogStack(app, "JwBlogSiteStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    // CloudFront distributions are global, but ACM certs for them must live in us-east-1.
    // Deploying the whole stack to us-east-1 keeps things simple.
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  domainName: process.env.DOMAIN_NAME,
  hostedZoneId: process.env.HOSTED_ZONE_ID,
  hostedZoneName: process.env.HOSTED_ZONE_NAME,
});
