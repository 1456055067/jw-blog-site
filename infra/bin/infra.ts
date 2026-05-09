#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { BlogStack } from "../lib/blog-stack";
import { PipelineStack } from "../lib/pipeline-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  // CloudFront distributions are global, but ACM certs for them must live in
  // us-east-1. Deploying both stacks to us-east-1 keeps things simple.
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const blogStack = new BlogStack(app, "JwBlogSiteStack", {
  env,
  domainName: process.env.DOMAIN_NAME,
  hostedZoneId: process.env.HOSTED_ZONE_ID,
  hostedZoneName: process.env.HOSTED_ZONE_NAME,
  existingCertificateArn: process.env.EXISTING_CERTIFICATE_ARN,
});

// CI/CD identity. Deploy this stack once with `cdk deploy JwBlogPipelineStack`
// and copy the RoleArn output into the AWS_ROLE_ARN secret on the GitHub repo.
const pipelineStack = new PipelineStack(app, "JwBlogPipelineStack", {
  env,
  githubOwner: "1456055067",
  githubRepo: "jw-blog-site",
  allowedBranches: ["main"],
});

// Tag both stacks so all resources are easily filterable in Cost Explorer / Resource Groups.
cdk.Tags.of(blogStack).add("Project", "jw-blog-site");
cdk.Tags.of(pipelineStack).add("Project", "jw-blog-site");
