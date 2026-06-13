import { useCallback, useRef, useState } from 'react';
import type { Config } from '../../config/index.js';
import { AgentSession } from '../../agent/loop.js';
import { SkillManager, type Skill } from '../../skills/index.js';
import type { AgentEvent } from '../../types.js';
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
  listSkills: () => Skill[];
  installSkill: (spec: string) => Promise<void>;
  removeSkill: (name: string) => void;
}

export function useAgent(config: Config): UseAgent {
  const skillsRef = useRef<SkillManager | null>(null);
  if (!skillsRef.current) skillsRef.current = new SkillManager();
  const skills = skillsRef.current;

  const sessionRef = useRef<AgentSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new AgentSession(config, skills);
  const session = sessionRef.current;

  const [history, setHistory] = useState<UIItem[]>([]);
  const [live, setLive] = useState<UIItem[]>([]);
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

  const flushLive = useCallback(() => {
    setLive((curLive) => {
      if (curLive.length) setHistory((h) => [...h, ...curLive]);
      return [];
    });
    activeAssistantId.current = null;
  }, []);

  const pushNotice = useCallback((text: string, level: 'info' | 'error' = 'info') => {
    setHistory((h) => [...h, { id: nextId(), kind: 'notice', level, text }]);
  }, []);

  const clear = useCallback(() => {
    setHistory([]);
    setLive([]);
    activeAssistantId.current = null;
  }, []);

  const handleEvent = useCallback(
    (ev: AgentEvent) => {
      switch (ev.type) {
        case 'streaming': {
          setLive((cur) => {
            const last = cur[cur.length - 1];
            if (last && last.kind === 'assistant' && last.id === activeAssistantId.current) {
              const updated = { ...last, text: last.text + ev.delta };
              return [...cur.slice(0, -1), updated];
            }
            const id = nextId();
            activeAssistantId.current = id;
            return [...cur, { id, kind: 'assistant', text: ev.delta }];
          });
          break;
        }
        case 'tool_use_start': {
          activeAssistantId.current = null;
          setLive((cur) => [
            ...cur,
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
          setLive((cur) =>
            cur.map((it) =>
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
          setLive((cur) => [...cur, { id: nextId(), kind: 'notice', level: 'error', text: ev.message }]);
          flushLive();
          setStatus((s) => ({ ...s, busy: false }));
          break;
        }
      }
    },
    [flushLive],
  );

  const begin = useCallback(async () => {
    try {
      await session.start(handleEvent);
      setReady(true);
    } catch (err) {
      setStartup((err as Error).message);
      setStatus((s) => ({ ...s, sandbox: 'error' }));
    }
  }, [session, handleEvent]);

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
    session.abort();
    setStatus((s) => ({ ...s, busy: false }));
    pushNotice('Aborted.', 'error');
    flushLive();
  }, [session, pushNotice, flushLive]);

  const listSkills = useCallback(() => session.skillList, [session]);

  const installSkill = useCallback(
    async (spec: string) => {
      pushNotice(`Installing skill from ${spec}…`);
      try {
        const names = await skills.installFromGitHub(spec);
        session.reloadSkills();
        pushNotice(`Installed skill(s): ${names.join(', ')}`);
      } catch (err) {
        pushNotice(`Skill install failed: ${(err as Error).message}`, 'error');
      }
    },
    [skills, session, pushNotice],
  );

  const removeSkill = useCallback(
    (name: string) => {
      const ok = skills.remove(name);
      session.reloadSkills();
      pushNotice(ok ? `Removed skill: ${name}` : `Skill not found: ${name}`, ok ? 'info' : 'error');
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
    listSkills,
    installSkill,
    removeSkill,
  };
}
