import type { Config } from '../config/index.js';
import { modelForTier } from '../config/index.js';
import type { Sandbox } from '../sandbox/index.js';
import { createSandbox } from '../sandbox/index.js';
import type { LLMClient } from '../llm/index.js';
import { createLLMClient } from '../llm/index.js';
import { allTools } from '../tools/index.js';
import { makeSkillTool } from '../tools/skill.js';
import { SkillManager, type Skill } from '../skills/index.js';
import type {
  AgentEvent,
  ContentBlock,
  ConversationMessage,
  EventSink,
  ToolContext,
  ToolDefinition,
} from '../types.js';
import { buildSystemPrompt } from './prompt.js';
import { estimateCostUSD } from './pricing.js';

// Drives the agentic loop: stream a model turn, dispatch any tool calls inside
// the sandbox, feed results back, repeat until the model stops or maxTurns.
export class AgentSession {
  readonly config: Config;
  private sandbox: Sandbox;
  private llm: LLMClient;
  private messages: ConversationMessage[] = [];
  private toolCtx: ToolContext;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private abortController: AbortController | null = null;
  private started = false;
  private skills: SkillManager;
  private loadedSkills: Skill[] = [];
  private tools: ToolDefinition[] = [];
  private toolMap = new Map<string, ToolDefinition>();

  constructor(config: Config, skills: SkillManager = new SkillManager()) {
    this.config = config;
    this.sandbox = createSandbox(config);
    this.llm = createLLMClient(config);
    this.skills = skills;
    this.toolCtx = {
      exec: (cmd, opts) => this.sandbox.exec(cmd, opts),
      readFile: (p) => this.sandbox.readFile(p),
      writeFile: (p, c) => this.sandbox.writeFile(p, c),
      workdir: this.sandbox['workdir'] as string,
    };
    this.rebuildTools();
  }

  // Compose the active tool list: base tools plus a Skill tool when any skills
  // are installed. Call after skills change.
  private rebuildTools(): void {
    this.loadedSkills = this.skills.list();
    this.tools = [...allTools];
    if (this.loadedSkills.length > 0) this.tools.push(makeSkillTool(this.skills));
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]));
  }

  describeEnvironment(): string {
    return this.sandbox.describe();
  }

  get workdir(): string {
    return this.toolCtx.workdir;
  }

  async start(sink: EventSink): Promise<void> {
    if (this.started) return;
    await this.sandbox.start((status, detail) => sink({ type: 'sandbox_status', status, detail }));
    // Refresh workdir (SSH resolves "~" during start).
    this.toolCtx.workdir = this.sandbox['workdir'] as string;
    this.started = true;
  }

  // Rebuild the sandbox from the (possibly mutated) config and start it again.
  // Used when the user changes the execution environment at runtime, e.g. via
  // the `/env` or `/docker` slash commands.
  async restartSandbox(sink: EventSink): Promise<void> {
    try {
      await this.sandbox.stop();
    } catch {
      // best-effort teardown
    }
    this.sandbox = createSandbox(this.config);
    this.started = false;
    await this.start(sink);
  }

  abort(): void {
    this.abortController?.abort();
  }

  async stop(): Promise<void> {
    await this.sandbox.stop();
  }

  // Re-scan installed skills (e.g. after an install during the session).
  reloadSkills(): Skill[] {
    this.rebuildTools();
    return this.loadedSkills;
  }

  get skillList(): Skill[] {
    return this.loadedSkills;
  }

  private emitCost(sink: EventSink): void {
    const totalCostUSD = estimateCostUSD(
      this.config.selectedTier,
      this.totalInputTokens,
      this.totalOutputTokens,
    );
    sink({
      type: 'cost_update',
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      totalCostUSD,
    });
  }

  async sendMessage(userText: string, sink: EventSink): Promise<void> {
    this.messages.push({ role: 'user', content: [{ type: 'text', text: userText }] });

    const model = modelForTier(this.config);
    const system = buildSystemPrompt(this.workdir, this.loadedSkills);
    this.abortController = new AbortController();

    for (let turn = 0; turn < this.config.maxTurns; turn++) {
      let result;
      try {
        result = await this.llm.stream({
          model,
          system,
          messages: this.messages,
          tools: this.tools,
          maxTokens: this.config.maxTokens,
          onTextDelta: (delta) => sink({ type: 'streaming', delta }),
          onThinkingDelta: (delta) => sink({ type: 'thinking', delta }),
          signal: this.abortController.signal,
        });
      } catch (err) {
        sink({ type: 'error', message: (err as Error).message, fatal: false });
        return;
      }

      this.totalInputTokens += result.inputTokens;
      this.totalOutputTokens += result.outputTokens;
      this.emitCost(sink);

      // Record the assistant turn (text + tool_use blocks).
      const assistantBlocks: ContentBlock[] = [];
      if (result.text) assistantBlocks.push({ type: 'text', text: result.text });
      for (const call of result.toolCalls) {
        assistantBlocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
      }
      if (assistantBlocks.length === 0) assistantBlocks.push({ type: 'text', text: '' });
      this.messages.push({ role: 'assistant', content: assistantBlocks });

      if (result.toolCalls.length === 0) {
        sink({ type: 'turn_complete', stopReason: result.stopReason });
        return;
      }

      // Execute each tool call and collect tool_result blocks.
      const resultBlocks: ContentBlock[] = [];
      for (const call of result.toolCalls) {
        sink({ type: 'tool_use_start', id: call.id, name: call.name, input: call.input });
        const startedAt = Date.now();
        const tool = this.toolMap.get(call.name);
        let content: string;
        let isError = false;
        if (!tool) {
          content = `Unknown tool: ${call.name}`;
          isError = true;
        } else {
          try {
            content = await tool.run(call.input, this.toolCtx);
          } catch (err) {
            content = (err as Error).message;
            isError = true;
          }
        }
        const durationMs = Date.now() - startedAt;
        sink({ type: 'tool_result', id: call.id, content, isError, durationMs });
        resultBlocks.push({ type: 'tool_result', tool_use_id: call.id, content, is_error: isError });
      }

      this.messages.push({ role: 'user', content: resultBlocks });
    }

    sink({ type: 'error', message: `Reached max turns (${this.config.maxTurns}).`, fatal: false });
  }
}

export type { AgentEvent };
