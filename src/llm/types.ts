import type { ConversationMessage, ModelTurn, ToolDefinition } from '../types.js';

export interface StreamParams {
  model: string;
  system: string;
  messages: ConversationMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
  onTextDelta: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

// A provider-agnostic streaming chat client. Implementations normalize their
// wire format into our ModelTurn / ContentBlock shapes.
export interface LLMClient {
  stream(params: StreamParams): Promise<ModelTurn>;
}
