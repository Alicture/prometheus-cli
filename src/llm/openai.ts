import type { ConversationMessage, ModelTurn, ToolCall } from '../types.js';
import type { LLMClient, StreamParams } from './types.js';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

// OpenAI-compatible /v1/chat/completions streaming client. Mirrors the original
// Bun server's callOpenAIStreaming so existing proxy gateways keep working.
export class OpenAICompatClient implements LLMClient {
  private apiKey: string;
  private baseURL: string;

  constructor(opts: { apiKey: string; baseURL?: string }) {
    this.apiKey = opts.apiKey;
    this.baseURL = (opts.baseURL && opts.baseURL.trim()) || 'https://api.openai.com';
  }

  private toOpenAIMessages(system: string, messages: ConversationMessage[]): OpenAIMessage[] {
    const out: OpenAIMessage[] = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'assistant') {
        let text = '';
        const toolCalls: NonNullable<OpenAIMessage['tool_calls']> = [];
        for (const b of m.content) {
          if (b.type === 'text') text += b.text;
          else if (b.type === 'tool_use') {
            toolCalls.push({
              id: b.id,
              type: 'function',
              function: { name: b.name, arguments: JSON.stringify(b.input) },
            });
          }
        }
        out.push({
          role: 'assistant',
          content: text || null,
          tool_calls: toolCalls.length ? toolCalls : undefined,
        });
      } else {
        // user: text becomes a user message; tool_result becomes tool messages.
        let text = '';
        for (const b of m.content) {
          if (b.type === 'text') text += b.text;
          else if (b.type === 'tool_result') {
            out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content });
          }
        }
        if (text) out.push({ role: 'user', content: text });
      }
    }
    return out;
  }

  async stream(params: StreamParams): Promise<ModelTurn> {
    const tools = params.tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));

    const url = `${this.baseURL.replace(/\/$/, '')}/v1/chat/completions`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens,
        messages: this.toOpenAIMessages(params.system, params.messages),
        tools,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: params.signal,
    });

    if (!resp.ok || !resp.body) {
      const body = await resp.text().catch(() => '');
      throw new Error(`LLM request failed (${resp.status}): ${body.slice(0, 500)}`);
    }

    let text = '';
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | null = null;

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        let json: any;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (json.usage) {
          inputTokens = json.usage.prompt_tokens ?? inputTokens;
          outputTokens = json.usage.completion_tokens ?? outputTokens;
        }
        const choice = json.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (delta.content) {
          text += delta.content;
          params.onTextDelta(delta.content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const cur = toolAcc.get(idx) ?? { id: '', name: '', args: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            toolAcc.set(idx, cur);
          }
        }
        if (choice.finish_reason) stopReason = choice.finish_reason;
      }
    }

    const toolCalls: ToolCall[] = [];
    for (const { id, name, args } of toolAcc.values()) {
      if (!name) continue;
      let input: Record<string, unknown> = {};
      try {
        input = args ? JSON.parse(args) : {};
      } catch {
        input = {};
      }
      toolCalls.push({ id: id || `call_${toolCalls.length}`, name, input });
    }

    return { text, thinking: '', toolCalls, inputTokens, outputTokens, stopReason };
  }
}
