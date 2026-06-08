import type { Config } from '../config/index.js';
import type { LLMClient } from './types.js';
import { AnthropicClient } from './anthropic.js';
import { OpenAICompatClient } from './openai.js';

export type { LLMClient, StreamParams } from './types.js';

// Pick the LLM client based on config.apiFormat. Default is the native
// Claude-compatible Anthropic Messages API.
export function createLLMClient(config: Config): LLMClient {
  if (config.apiFormat === 'openai') {
    return new OpenAICompatClient({ apiKey: config.apiKey, baseURL: config.baseURL });
  }
  return new AnthropicClient({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    anthropicVersion: config.anthropicVersion,
  });
}
