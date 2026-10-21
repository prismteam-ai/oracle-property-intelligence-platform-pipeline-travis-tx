// The AWS SDK v3 is part of the Lambda base image; only the names the chat function's secret loader uses are typed here.
declare module '@aws-sdk/client-secrets-manager' {
  export class SecretsManagerClient {
    constructor(config: Record<string, unknown>);
    send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>;
  }
  export class GetSecretValueCommand {
    constructor(input: { SecretId: string });
  }
}
