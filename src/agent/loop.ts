import type { Config } from '../config/index.js';
import { modelForTier } from '../config/index.js';
import type { Sandbox } from '../sandbox/index.js';
import { createSandbox } from '../sandbox/index.js';
import { LocalSandbox } from '../sandbox/local.js';
import type { LLMClient } from '../llm/index.js';
import { createLLMClient } from '../llm/index.js';
import { allTools, HostBash } from '../tools/index.js';
import { makeSkillTool, type SkillPlacement } from '../tools/skill.js';
import { SkillManager, createSkillManager, type Skill } from '../skills/index.js';
import type {
  AgentEvent,
  ApprovalDecision,
  Approver,
  ContentBlock,
  ConversationMessage,
  EventSink,
  ExecResult,
  ToolContext,
  ToolDefinition,
} from '../types.js';
import { buildSystemPrompt } from './prompt.js';
import { estimateCostUSD } from './pricing.js';

// Where a skill's bundled files are copied inside the sandbox, relative to the
// working directory (which is writable by definition).
const SANDBOX_SKILLS_DIR = '.prometheus/skills';

// One-line, human-readable summary of a tool call for approval prompts/logs.
function summarizeTool(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') return String(input.command ?? '');
  if (name === 'HostBash') return `on host: ${String(input.command ?? '')}`;
  if (name === 'FileWrite' || name === 'FileEdit' || name === 'FileRead') return String(input.path ?? '');
  if (name === 'Grep') return `pattern ${String(input.pattern ?? '')}`;
  if (name === 'Glob') return String(input.pattern ?? '');
  if (name === 'Skill') return String(input.name ?? input.command ?? '');
  const keys = Object.keys(input);
  return keys.length ? `${keys[0]}=${String(input[keys[0]])}` : '';
}

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
  private approver?: Approver;
  // Tool names approved for the rest of this session ("always allow").
  private sessionAllow = new Set<string>();
  // Lazily created executor for host-only skills; only used when the sandbox is
  // something other than this machine.
  private hostExec: LocalSandbox | null = null;
  // Skills whose bundled files have already been copied into the sandbox,
  // mapped to the path they were copied to. Cleared whenever the sandbox is
  // replaced.
  private pushedSkills = new Map<string, string>();

  constructor(config: Config, skills: SkillManager = createSkillManager(config)) {
    this.config = config;
    this.sandbox = createSandbox(config);
    this.llm = createLLMClient(config);
    this.skills = skills;
    this.toolCtx = {
      exec: (cmd, opts) => this.sandbox.exec(cmd, opts),
      readFile: (p) => this.sandbox.readFile(p),
      writeFile: (p, c) => this.sandbox.writeFile(p, c),
      workdir: this.sandbox['workdir'] as string,
      execHost: (cmd, opts) => this.execOnHost(cmd, opts),
    };
    this.rebuildTools();
  }

  // Runs a command on this machine, for skills that cannot work anywhere else.
  private async execOnHost(
    command: string,
    opts?: { cwd?: string; timeoutMs?: number },
  ): Promise<ExecResult> {
    if (!this.hostExec) {
      this.hostExec = new LocalSandbox({ workspace: process.cwd() }, this.config.maxOutputSize);
      await this.hostExec.start();
    }
    return this.hostExec.exec(command, opts);
  }

  // Register the UI callback used to request tool-execution approval.
  setApprover(approver: Approver): void {
    this.approver = approver;
  }

  // Decide whether a tool call may run, prompting the user when needed.
  // Returns 'allow' or 'deny' (after resolving any prompt / policy).
  private async authorizeTool(tool: ToolDefinition | undefined, id: string, name: string, input: Record<string, unknown>): Promise<ApprovalDecision> {
    // Read-only tools never need approval.
    if (tool?.readOnly) return 'allow';
    const mode = this.config.permissions.mode;
    if (mode === 'auto') return 'allow';
    if (mode === 'readonly') return 'deny';
    // mode === 'ask'
    if (this.config.permissions.allow.includes(name) || this.sessionAllow.has(name)) return 'allow';
    if (!this.approver) return 'allow'; // no UI to ask (e.g. non-interactive) -> permissive
    const decision = await this.approver({
      id,
      name,
      input,
      summary: summarizeTool(name, input),
      readOnly: !!tool?.readOnly,
    });
    if (decision === 'always') this.sessionAllow.add(name);
    return decision === 'deny' ? 'deny' : 'allow';
  }

  // Compose the active tool list: base tools plus a Skill tool when any skills
  // are installed, plus HostBash when host-only skills need to reach this
  // machine. Call after skills change.
  private rebuildTools(): void {
    this.loadedSkills = this.skills.list();
    this.tools = [...allTools];
    if (this.hostSkillsActive()) this.tools.push(HostBash);
    if (this.loadedSkills.length > 0) {
      this.tools.push(
        makeSkillTool(
          this.skills,
          (skill) => this.placeSkill(skill),
          this.hostSkillsActive() ? this.config.skills.hostSkills : [],
        ),
      );
    }
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]));
  }

  // Host-only skills are pointless when the sandbox already IS the host: Bash
  // reaches everything, so no escape hatch is offered.
  private hostSkillsActive(): boolean {
    return this.config.skills.hostSkills.length > 0 && !this.sandbox.isHost;
  }

  private isHostSkill(name: string): boolean {
    return this.config.skills.hostSkills.some((n) => n.toLowerCase() === name.toLowerCase());
  }

  // Skills are installed on this machine, but tools run in the sandbox, so a
  // skill's bundled scripts are invisible there. Copy them in on demand and
  // report the path that the model's tools can actually reach.
  private async placeSkill(skill: Skill): Promise<SkillPlacement> {
    if (this.isHostSkill(skill.name)) {
      return { path: skill.path, onHost: true, hostOnly: !this.sandbox.isHost };
    }
    // Nothing to copy: the sandbox is this machine, or SKILL.md (already
    // inlined above) is the skill's only file.
    if (this.sandbox.isHost) return { path: skill.path, onHost: true };
    if (skill.resources.length === 0) return { path: skill.path, onHost: true };

    const cached = this.pushedSkills.get(skill.name);
    if (cached) return { path: cached, onHost: false };
    const dest = `${this.toolCtx.workdir}/${SANDBOX_SKILLS_DIR}/${skill.name}`;
    try {
      await this.sandbox.pushDir(skill.path, dest);
      this.pushedSkills.set(skill.name, dest);
      return { path: dest, onHost: false };
    } catch (err) {
      return { path: skill.path, onHost: true, error: (err as Error).message };
    }
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
    this.pushedSkills.clear();
    this.started = false;
    await this.start(sink);
    // isHost may have changed with the environment, which decides whether
    // HostBash is offered.
    this.rebuildTools();
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

  // Rebuild the LLM client from the (possibly mutated) config, e.g. after the
  // user changes the API key / base URL / format via the /provider command.
  rebuildLLM(): void {
    this.llm = createLLMClient(this.config);
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
    const system = buildSystemPrompt(this.workdir, this.loadedSkills, {
      hostSkills: this.hostSkillsActive() ? this.config.skills.hostSkills : [],
    });
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

        const decision = await this.authorizeTool(tool, call.id, call.name, call.input);
        if (decision === 'deny') {
          content = `Permission denied by user: the ${call.name} tool was not run.`;
          isError = true;
          sink({ type: 'tool_result', id: call.id, content, isError, durationMs: Date.now() - startedAt });
          resultBlocks.push({ type: 'tool_result', tool_use_id: call.id, content, is_error: true });
          continue;
        }

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
