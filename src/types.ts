// Core domain types shared across the agent loop, tools, sandbox and UI.

export type Role = 'user' | 'assistant';

// Anthropic-style content blocks. We normalize everything to this shape
// internally regardless of which API format (anthropic|openai) is used.
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

export interface ConversationMessage {
  role: Role;
  content: ContentBlock[];
}

// A single tool call requested by the model.
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// Normalized result of one model turn (after streaming completes).
export interface ModelTurn {
  text: string;
  thinking: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
}

// Events emitted by the agent loop, consumed by the Ink UI.
export type AgentEvent =
  | { type: 'streaming'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_use_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; content: string; isError: boolean; durationMs: number }
  | { type: 'cost_update'; inputTokens: number; outputTokens: number; totalCostUSD: number }
  | { type: 'turn_complete'; stopReason: string | null }
  | { type: 'sandbox_status'; status: 'creating' | 'ready' | 'error'; detail?: string }
  | { type: 'error'; message: string; fatal: boolean };

export type EventSink = (event: AgentEvent) => void;

// A tool definition with a JSON-schema input and an executor.
export interface ToolContext {
  exec(command: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<ExecResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  workdir: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // Read-only tools never mutate state and are exempt from approval prompts.
  readOnly?: boolean;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

// ---- Permission / approval system ----
// Before running a side-effecting tool, the agent asks for approval. The UI
// resolves the returned promise with the user's decision.
export interface ApprovalRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
  summary: string;
  readOnly: boolean;
}

export type ApprovalDecision = 'allow' | 'always' | 'deny';

export type Approver = (req: ApprovalRequest) => Promise<ApprovalDecision>;
