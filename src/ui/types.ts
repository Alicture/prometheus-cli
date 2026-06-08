// UI-level representation of conversation items rendered in the terminal.
export type UIItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | {
      id: string;
      kind: 'tool';
      toolId: string;
      name: string;
      input: Record<string, unknown>;
      status: 'running' | 'done' | 'error';
      content: string;
      durationMs: number;
    }
  | { id: string; kind: 'notice'; level: 'info' | 'error'; text: string };

export interface UIStatus {
  sandbox: 'idle' | 'creating' | 'ready' | 'error';
  sandboxDetail: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  busy: boolean;
}
