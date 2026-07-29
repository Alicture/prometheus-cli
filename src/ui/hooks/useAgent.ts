import { useCallback, useEffect, useRef, useState } from 'react';
import type { Config } from '../../config/index.js';
import { AgentSession } from '../../agent/loop.js';
import { SkillManager, createSkillManager, type Skill, type SkillRoot } from '../../skills/index.js';
import type { AgentEvent, ApprovalDecision, ApprovalRequest } from '../../types.js';
import type { UIItem, UIStatus } from '../types.js';

let counter = 0;
const nextId = () => `i${++counter}`;

export interface UseAgent {
  history: UIItem[]; // finalized items (render in <Static>)
  live: UIItem[]; // in-progress turn
  status: UIStatus;
  ready: boolean;
  startup: string | null; // startup error, if any
  envLabel: string;
  begin: () => Promise<void>;
  send: (text: string) => void;
  abort: () => void;
  pushNotice: (text: string, level?: 'info' | 'error') => void;
  clear: () => void;
  restart: () => Promise<void>;
  refreshProvider: () => void;
  pendingApproval: ApprovalRequest | null;
  resolveApproval: (decision: ApprovalDecision) => void;
  listSkills: () => Skill[];
  installSkill: (spec: string, only?: string[]) => Promise<void>;
  searchSkills: (spec: string) => Promise<void>;
  skillDirs: () => Array<SkillRoot & { exists: boolean; count: number }>;
  refreshSkills: () => void;
  removeSkill: (name: string) => void;
}

export function useAgent(config: Config): UseAgent {
  const skillsRef = useRef<SkillManager | null>(null);
  if (!skillsRef.current) skillsRef.current = createSkillManager(config);
  const skills = skillsRef.current;

  const sessionRef = useRef<AgentSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new AgentSession(config, skills);
  const session = sessionRef.current;

  const [history, setHistory] = useState<UIItem[]>([]);
  const [live, setLive] = useState<UIItem[]>([]);
  // Mirror of `live` for synchronous reads inside event handlers, so updates
  // are computed deterministically (no impure logic inside state updaters).
  const liveRef = useRef<UIItem[]>([]);
  const setLiveSafe = useCallback((next: UIItem[]) => {
    liveRef.current = next;
    setLive(next);
  }, []);
  const [ready, setReady] = useState(false);
  const [startup, setStartup] = useState<string | null>(null);
  const [envLabel, setEnvLabel] = useState<string>(() => session.describeEnvironment());
  const [status, setStatus] = useState<UIStatus>({
    sandbox: 'idle',
    sandboxDetail: '',
    inputTokens: 0,
    outputTokens: 0,
    costUSD: 0,
    busy: false,
  });

  // Tracks the id of the assistant item currently receiving streamed text.
  const activeAssistantId = useRef<string | null>(null);

  // Pending tool-approval request + the resolver that the prompt UI calls.
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
  const approvalResolver = useRef<((d: ApprovalDecision) => void) | null>(null);

  const approve = useCallback(
    (req: ApprovalRequest) =>
      new Promise<ApprovalDecision>((resolve) => {
        approvalResolver.current = resolve;
        setPendingApproval(req);
      }),
    [],
  );

  const resolveApproval = useCallback((decision: ApprovalDecision) => {
    const resolver = approvalResolver.current;
    approvalResolver.current = null;
    setPendingApproval(null);
    resolver?.(decision);
  }, []);

  const flushLive = useCallback(() => {
    const curLive = liveRef.current;
    if (curLive.length) setHistory((h) => [...h, ...curLive]);
    liveRef.current = [];
    setLive([]);
    activeAssistantId.current = null;
  }, []);

  const pushNotice = useCallback((text: string, level: 'info' | 'error' = 'info') => {
    setHistory((h) => [...h, { id: nextId(), kind: 'notice', level, text }]);
  }, []);

  const clear = useCallback(() => {
    setHistory([]);
    liveRef.current = [];
    setLive([]);
    activeAssistantId.current = null;
  }, []);

  const handleEvent = useCallback(
    (ev: AgentEvent) => {
      switch (ev.type) {
        case 'streaming': {
          const cur = liveRef.current;
          if (activeAssistantId.current === null) {
            const id = nextId();
            activeAssistantId.current = id;
            setLiveSafe([...cur, { id, kind: 'assistant', text: ev.delta }]);
          } else {
            const id = activeAssistantId.current;
            setLiveSafe(
              cur.map((it) =>
                it.id === id && it.kind === 'assistant' ? { ...it, text: it.text + ev.delta } : it,
              ),
            );
          }
          break;
        }
        case 'tool_use_start': {
          activeAssistantId.current = null;
          setLiveSafe([
            ...liveRef.current,
            {
              id: nextId(),
              kind: 'tool',
              toolId: ev.id,
              name: ev.name,
              input: ev.input,
              status: 'running',
              content: '',
              durationMs: 0,
            },
          ]);
          break;
        }
        case 'tool_result': {
          setLiveSafe(
            liveRef.current.map((it) =>
              it.kind === 'tool' && it.toolId === ev.id
                ? {
                    ...it,
                    status: ev.isError ? 'error' : 'done',
                    content: ev.content,
                    durationMs: ev.durationMs,
                  }
                : it,
            ),
          );
          break;
        }
        case 'cost_update': {
          setStatus((s) => ({
            ...s,
            inputTokens: ev.inputTokens,
            outputTokens: ev.outputTokens,
            costUSD: ev.totalCostUSD,
          }));
          break;
        }
        case 'sandbox_status': {
          setStatus((s) => ({ ...s, sandbox: ev.status, sandboxDetail: ev.detail ?? s.sandboxDetail }));
          break;
        }
        case 'turn_complete': {
          flushLive();
          setStatus((s) => ({ ...s, busy: false }));
          break;
        }
        case 'error': {
          setLiveSafe([
            ...liveRef.current,
            { id: nextId(), kind: 'notice', level: 'error', text: ev.message },
          ]);
          flushLive();
          setStatus((s) => ({ ...s, busy: false }));
          break;
        }
      }
    },
    [flushLive, setLiveSafe],
  );

  const begin = useCallback(async () => {
    session.setApprover(approve);
    try {
      await session.start(handleEvent);
      setReady(true);
    } catch (err) {
      setStartup((err as Error).message);
      setStatus((s) => ({ ...s, sandbox: 'error' }));
    }
  }, [session, handleEvent, approve]);

  // Release the sandbox when the app unmounts. This is the graceful path; the
  // sandbox also registers a synchronous teardown for signals and hard exits.
  useEffect(() => {
    return () => {
      void session.stop().catch(() => {
        // best-effort teardown on the way out
      });
    };
  }, [session]);

  // Tear down and recreate the sandbox from the current config (e.g. after the
  // user switches environment with /env or /docker at runtime).
  const restart = useCallback(async () => {
    setReady(false);
    setStartup(null);
    try {
      await session.restartSandbox(handleEvent);
      setEnvLabel(session.describeEnvironment());
      setReady(true);
      pushNotice(`Environment ready → ${session.describeEnvironment()}`);
    } catch (err) {
      setEnvLabel(session.describeEnvironment());
      setStartup((err as Error).message);
      setStatus((s) => ({ ...s, sandbox: 'error' }));
      pushNotice(`Failed to start sandbox: ${(err as Error).message}`, 'error');
    }
  }, [session, handleEvent, pushNotice]);

  const send = useCallback(
    (text: string) => {
      setHistory((h) => [...h, { id: nextId(), kind: 'user', text }]);
      setStatus((s) => ({ ...s, busy: true }));
      activeAssistantId.current = null;
      void session.sendMessage(text, handleEvent);
    },
    [session, handleEvent],
  );

  const abort = useCallback(() => {
    // Resolve any pending approval prompt as a denial before aborting.
    if (approvalResolver.current) resolveApproval('deny');
    session.abort();
    setStatus((s) => ({ ...s, busy: false }));
    pushNotice('Aborted.', 'error');
    flushLive();
  }, [session, pushNotice, flushLive, resolveApproval]);

  const listSkills = useCallback(() => session.skillList, [session]);

  const refreshProvider = useCallback(() => {
    session.rebuildLLM();
  }, [session]);

  const installSkill = useCallback(
    async (spec: string, only?: string[]) => {
      pushNotice(`Installing skills from ${spec}…`);
      try {
        const installed = await skills.install(spec, only);
        session.reloadSkills();
        const lines = installed.map((s) => `  ${s.name} — ${s.description || '(no description)'}`);
        pushNotice(`Installed ${installed.length} skill(s):\n${lines.join('\n')}`);
      } catch (err) {
        pushNotice(`Skill install failed: ${(err as Error).message}`, 'error');
      }
    },
    [skills, session, pushNotice],
  );

  const searchSkills = useCallback(
    async (spec: string) => {
      pushNotice(`Looking up skills in ${spec}…`);
      try {
        const names = await skills.preview(spec);
        pushNotice(
          `${names.length} skill(s) in ${spec}:\n${names.map((n) => `  ${n}`).join('\n')}\n` +
            `Install all with: /skill install ${spec}`,
        );
      } catch (err) {
        pushNotice(`Skill search failed: ${(err as Error).message}`, 'error');
      }
    },
    [skills, pushNotice],
  );

  const skillDirs = useCallback(() => skills.rootStatus(), [skills]);

  const refreshSkills = useCallback(() => {
    session.reloadSkills();
  }, [session]);

  const removeSkill = useCallback(
    (name: string) => {
      const result = skills.remove(name);
      session.reloadSkills();
      pushNotice(result.ok ? `Removed skill: ${name}` : result.reason!, result.ok ? 'info' : 'error');
    },
    [skills, session, pushNotice],
  );

  return {
    history,
    live,
    status,
    ready,
    startup,
    envLabel,
    begin,
    send,
    abort,
    pushNotice,
    clear,
    restart,
    refreshProvider,
    pendingApproval,
    resolveApproval,
    listSkills,
    installSkill,
    searchSkills,
    skillDirs,
    refreshSkills,
    removeSkill,
  };
}
