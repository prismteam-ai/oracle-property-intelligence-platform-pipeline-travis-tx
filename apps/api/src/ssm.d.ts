// The AWS SDK v3 is part of the Lambda base image; only the two names the chat placeholder uses are typed here.
declare module '@aws-sdk/client-ssm' {
  export class SSMClient {
    constructor(config: Record<string, unknown>);
    send(command: GetParameterCommand): Promise<{ Parameter?: { Value?: string } }>;
  }
  export class GetParameterCommand {
    constructor(input: { Name: string });
  }
}
