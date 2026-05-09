import { Stack, StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";

export interface PipelineStackProps extends StackProps {
  /** GitHub username or organization, e.g. "1456055067". */
  readonly githubOwner: string;
  /** Repository name, e.g. "jw-blog-site". */
  readonly githubRepo: string;
  /** Branches the role may be assumed from. Default: ["main"]. */
  readonly allowedBranches?: string[];
}

/**
 * GitHub Actions → AWS deploy identity using OIDC federation.
 *
 * Creates the `token.actions.githubusercontent.com` identity provider
 * (account-global, one-per-account), then an IAM role that GitHub Actions
 * can assume via short-lived JWT tokens. The role's trust is scoped to a
 * specific repo + branch, and its permissions are limited to assuming the
 * CDK bootstrap roles in this account.
 *
 * Run: `cdk deploy JwBlogPipelineStack` once, capture the role ARN from
 * the output, set it as the `AWS_ROLE_ARN` GitHub repo secret.
 *
 * If the OIDC provider already exists in the account (from a previous
 * unrelated project), this stack will fail with "EntityAlreadyExists".
 * Workaround: import via `iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn`.
 */
export class PipelineStack extends Stack {
  readonly deployRoleArn: string;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const branches = props.allowedBranches ?? ["main"];

    const oidcProvider = new iam.OpenIdConnectProvider(
      this,
      "GitHubOidcProvider",
      {
        url: "https://token.actions.githubusercontent.com",
        clientIds: ["sts.amazonaws.com"],
      }
    );

    const subjectClaims = branches.map(
      (b) => `repo:${props.githubOwner}/${props.githubRepo}:ref:refs/heads/${b}`
    );

    const role = new iam.Role(this, "GitHubActionsDeployRole", {
      roleName: `gh-actions-${props.githubRepo}-deploy`,
      assumedBy: new iam.OpenIdConnectPrincipal(oidcProvider, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        },
        StringLike: {
          "token.actions.githubusercontent.com:sub": subjectClaims,
        },
      }),
      maxSessionDuration: Duration.hours(1),
      description: `Assumed by GitHub Actions in ${props.githubOwner}/${props.githubRepo} to deploy the blog stack`,
    });

    // Permission: assume the CDK bootstrap roles in this account/region.
    // CDK's deploy/file-publishing/cfn-exec/lookup roles handle the actual
    // resource permissions, so this role itself stays minimal.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-deploy-role-${this.account}-*`,
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-file-publishing-role-${this.account}-*`,
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-image-publishing-role-${this.account}-*`,
          `arn:aws:iam::${this.account}:role/cdk-hnb659fds-lookup-role-${this.account}-*`,
        ],
      })
    );

    this.deployRoleArn = role.roleArn;

    new CfnOutput(this, "RoleArn", {
      value: role.roleArn,
      description: "Set this as the GitHub repo secret AWS_ROLE_ARN",
    });
    new CfnOutput(this, "OidcProviderArn", { value: oidcProvider.openIdConnectProviderArn });
  }
}
