import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  Tool,
  TextBlockParam,
  ToolUseBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import type { ConversationMessage, ModelTurn, ToolCall } from '../types.js';
import type { LLMClient, StreamParams } from './types.js';

type AnyContentParam = TextBlockParam | ToolUseBlockParam | ToolResultBlockParam;

// Native Claude / Anthropic Messages API client (the required "Claude-compatible"
// path). Supports a custom baseURL so users can point at any Anthropic-compatible
// proxy or gateway.
export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private hasKey: boolean;

  constructor(opts: { apiKey: string; baseURL?: string; anthropicVersion?: string }) {
    this.hasKey = !!(opts.apiKey && opts.apiKey.trim());
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL && opts.baseURL.trim() ? opts.baseURL.trim() : undefined,
      defaultHeaders: opts.anthropicVersion ? { 'anthropic-version': opts.anthropicVersion } : undefined,
    });
  }

  private toAnthropicMessages(messages: ConversationMessage[]): MessageParam[] {
    return messages.map((m) => {
      const content: AnyContentParam[] = [];
      for (const block of m.content) {
        if (block.type === 'text') {
          if (block.text) content.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
        } else if (block.type === 'tool_result') {
          content.push({
            type: 'tool_result',
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          });
        }
        // 'thinking' blocks are not replayed back to the API.
      }
      // Anthropic requires non-empty content; fall back to a single space.
      if (content.length === 0) content.push({ type: 'text', text: ' ' });
      return { role: m.role, content };
    });
  }

  async stream(params: StreamParams): Promise<ModelTurn> {
    const tools: Tool[] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Tool['input_schema'],
    }));

    const stream = this.client.messages.stream(
      {
        model: params.model,
        max_tokens: params.maxTokens,
        system: params.system,
        messages: this.toAnthropicMessages(params.messages),
        tools,
      },
      {
        signal: params.signal,
        // Without an API key, explicitly omit the auth header so requests can
        // reach a no-auth proxy (and so the SDK doesn't throw its cryptic
        // "Could not resolve authentication method" error). When a key IS set,
        // the SDK sends x-api-key as usual.
        headers: this.hasKey ? undefined : { 'x-api-key': null },
      },
    );

    stream.on('text', (delta) => params.onTextDelta(delta));

    const final = await stream.finalMessage();

    let text = '';
    const thinking = '';
    const toolCalls: ToolCall[] = [];
    for (const block of final.content) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
      }
    }

    return {
      text,
      thinking,
      toolCalls,
      inputTokens: final.usage?.input_tokens ?? 0,
      outputTokens: final.usage?.output_tokens ?? 0,
      stopReason: final.stop_reason ?? null,
    };
  }
}
