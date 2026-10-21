import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { withBedrockPromptCaching, type CacheUsage } from './bedrock-prompt-cache.js';

/**
 * The Bedrock model behind the agent: the US cross-region inference profile named by BEDROCK_MODEL_ID (decisions.md
 * section 32), called through Converse with the function role's credentials from the Lambda environment, and wrapped
 * with prompt caching before any agent sees it (the kit's rule).
 */
export function bedrockModel(
  modelId: string,
  region = process.env.AWS_REGION ?? 'us-east-2',
  onCacheUsage?: (u: CacheUsage) => void,
) {
  const bedrock = createAmazonBedrock({ region });
  return withBedrockPromptCaching(bedrock(modelId), onCacheUsage);
}
