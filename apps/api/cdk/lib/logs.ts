import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CfnFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnResource } from 'aws-cdk-lib';

/** 90 days (RetentionDays.THREE_MONTHS). */
export const LOG_RETENTION = RetentionDays.THREE_MONTHS;

/**
 * Section 21: "90-day retention on every log group, custom-resource functions included".
 *
 * Call at the end of a stack constructor. Every AWS::Lambda::Function that has no LoggingConfig yet (the CDK's own
 * singleton providers: BucketDeployment, auto-delete objects) is pointed at an explicit 90-day log group.
 */
export function pinLambdaLogGroups(stack: Stack): void {
  const functions = stack.node
    .findAll()
    .filter(
      (c): c is CfnResource =>
        c instanceof CfnResource && c.cfnResourceType === 'AWS::Lambda::Function',
    );
  for (const fn of functions) {
    if (fn instanceof CfnFunction && fn.loggingConfig !== undefined) continue;
    const logGroup = new LogGroup(fn, 'PinnedLogGroup', {
      retention: LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    fn.addPropertyOverride('LoggingConfig.LogGroup', logGroup.logGroupName);
    fn.node.addDependency(logGroup);
  }
}
