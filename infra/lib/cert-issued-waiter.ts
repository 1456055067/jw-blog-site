import { Duration, CustomResource } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cr from "aws-cdk-lib/custom-resources";
import * as logs from "aws-cdk-lib/aws-logs";

export interface CertIssuedWaiterProps {
  /** ARN of the ACM certificate to wait on. */
  readonly certificateArn: string;
  /** How long to allow validation to take. Default 15 min. */
  readonly totalTimeout?: Duration;
  /** Polling interval. Default 15 s. */
  readonly queryInterval?: Duration;
}

/**
 * Polls ACM until the given certificate reaches Status=ISSUED, then signals
 * CloudFormation. Use it to gate downstream resources (CloudFront, etc.) on
 * actual cert validation, since the native AWS::CertificateManager::Certificate
 * resource has a CFN bug where it marks itself COMPLETE while still in
 * PENDING_VALIDATION (CFN's polling for the validation DnsRecord times out
 * before ACM populates it). See aws-cdk#8401.
 *
 * The construct is a no-op for already-issued certs — onEvent succeeds
 * immediately, isComplete passes on the first poll. So it's safe to wrap
 * any cert without performance cost.
 */
export class CertIssuedWaiter extends Construct {
  constructor(scope: Construct, id: string, props: CertIssuedWaiterProps) {
    super(scope, id);

    const onEventFn = new lambda.Function(this, "OnEventFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      timeout: Duration.seconds(30),
      logRetention: logs.RetentionDays.ONE_WEEK,
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          if (event.RequestType === "Delete") return {};
          return { PhysicalResourceId: event.ResourceProperties.CertificateArn };
        };
      `),
    });

    const isCompleteFn = new lambda.Function(this, "IsCompleteFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      timeout: Duration.seconds(30),
      logRetention: logs.RetentionDays.ONE_WEEK,
      code: lambda.Code.fromInline(`
        const { ACMClient, DescribeCertificateCommand } = require("@aws-sdk/client-acm");
        const acm = new ACMClient({});
        exports.handler = async (event) => {
          if (event.RequestType === "Delete") return { IsComplete: true };
          const arn = event.ResourceProperties.CertificateArn;
          const out = await acm.send(new DescribeCertificateCommand({ CertificateArn: arn }));
          const status = out.Certificate && out.Certificate.Status;
          console.log("cert " + arn + " status=" + status);
          return { IsComplete: status === "ISSUED" };
        };
      `),
    });

    isCompleteFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["acm:DescribeCertificate"],
        resources: [props.certificateArn],
      })
    );

    const provider = new cr.Provider(this, "Provider", {
      onEventHandler: onEventFn,
      isCompleteHandler: isCompleteFn,
      queryInterval: props.queryInterval ?? Duration.seconds(15),
      totalTimeout: props.totalTimeout ?? Duration.minutes(15),
    });

    new CustomResource(this, "Resource", {
      serviceToken: provider.serviceToken,
      properties: { CertificateArn: props.certificateArn },
      resourceType: "Custom::AcmCertificateIssued",
    });
  }
}
