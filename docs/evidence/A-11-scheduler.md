# A-11 scheduler deploy evidence (AC-12)

Deployed 2026-10-24, AWS account 515618610572, region eu-north-1.

```
$ AWS_PROFILE=assess aws scheduler get-schedule --name countylens-incremental-run --region eu-north-1
Name: countylens-incremental-run
State: DISABLED
ScheduleExpression: rate(1 day)
```

Stack outputs:
- ClusterArn: arn:aws:ecs:eu-north-1:515618610572:cluster/countylens-batch
- TaskDefinitionArn: arn:aws:ecs:eu-north-1:515618610572:task-definition/countylens-publish-run:1
- DlqArn: arn:aws:sqs:eu-north-1:515618610572:countylens-scheduler-run-task-dlq
- ScheduleName: countylens-incremental-run

The schedule is deployed but costs nothing while DISABLED (AC-12). No one has enabled it.
