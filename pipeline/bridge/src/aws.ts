// The two AWS effects, kept thin: SQS long poll/delete on the command queue, and PutObject of
// live/live.json. Credentials come from the AWS profile (default `assess`); the region from the
// profile or AWS_REGION, never hard-coded here.
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { LIVE_KEY } from "./live.js";
import type { QueueClient, QueueMessage } from "./types.js";

export function sqsQueue(queueUrl: string, profile: string): QueueClient {
  const client = new SQSClient({ profile });
  return {
    async receive(): Promise<QueueMessage | undefined> {
      const out = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 20,
        }),
      );
      const m = out.Messages?.[0];
      if (m?.ReceiptHandle === undefined || m.Body === undefined) return undefined;
      return { messageId: m.MessageId ?? "unknown", receiptHandle: m.ReceiptHandle, body: m.Body };
    },
    async delete(receiptHandle: string): Promise<void> {
      await client.send(
        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }),
      );
    },
  };
}

/** PutObject on live/live.json only, Cache-Control: no-store (the API caches for 5 s itself). */
export function livePutter(bucket: string, profile: string): (body: string) => Promise<void> {
  const client = new S3Client({ profile });
  return async (body) => {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: LIVE_KEY,
        Body: body,
        ContentType: "application/json",
        CacheControl: "no-store",
      }),
    );
  };
}

/** One message to the Ops topic (COUNTYLENS_ALERTS_TOPIC_ARN) when a run fails (review M3). */
export function snsAlert(
  topicArn: string,
  profile: string,
): (subject: string, message: string) => Promise<void> {
  const client = new SNSClient({ profile });
  return async (subject, message) => {
    await client.send(
      new PublishCommand({ TopicArn: topicArn, Subject: subject, Message: message }),
    );
  };
}
