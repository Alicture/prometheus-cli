import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, Static, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Config, Tier } from '../config/index.js';
import { modelForTier, saveConfig, TierSchema, TIER_LABELS } from '../config/index.js';
import { theme } from './theme.js';
import { useAgent } from './hooks/useAgent.js';
import { Header } from './components/Header.js';
import { MessageItem } from './components/MessageItem.js';
import { StatusBar } from './components/StatusBar.js';

const HELP = [
  '/help            show this help',
  '/model <tier>    switch model tier: hermes | athena | zeus',
  '/env             show the current execution environment',
  '/clear           clear the conversation',
  '/quit            exit Prometheus',
  '',
  'Esc aborts the current turn. Ctrl+C exits.',
].join('\n');

export function App({ config }: { config: Config }) {
  const { exit } = useApp();
  const agent = useAgent(config);
  const [input, setInput] = useState('');
  const [tier, setTier] = useState<Tier>(config.selectedTier);

  useEffect(() => {
    void agent.begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const model = useMemo(() => modelForTier({ ...config, selectedTier: tier }), [config, tier]);

  useInput((_input, key) => {
    if (key.escape && agent.status.busy) agent.abort();
  });

  const runCommand = (raw: string) => {
    const [cmd, ...rest] = raw.slice(1).trim().split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd) {
      case 'help':
        agent.pushNotice('\n' + HELP);
        break;
      case 'model': {
        const parsed = TierSchema.safeParse(arg);
        if (!parsed.success) {
          agent.pushNotice('Usage: /model hermes | athena | zeus', 'error');
          break;
        }
        setTier(parsed.data);
        config.selectedTier = parsed.data;
        saveConfig(config);
        agent.pushNotice(`Model tier → ${TIER_LABELS[parsed.data]} (${modelForTier(config)})`);
        break;
      }
      case 'env':
        agent.pushNotice(
          `Environment: ${agent.envLabel}\n` +
            `API: ${config.apiFormat} · base URL: ${config.baseURL || '(provider default)'}`,
        );
        break;
      case 'clear':
        agent.clear();
        break;
      case 'quit':
      case 'exit':
        exit();
        break;
      default:
        agent.pushNotice(`Unknown command: /${cmd}`, 'error');
    }
  };

  const onSubmit = (value: string) => {
    const text = value.trim();
    setInput('');
    if (!text) return;
    if (text.startsWith('/')) {
      runCommand(text);
      return;
    }
    if (!agent.ready) {
      agent.pushNotice('Sandbox is not ready yet.', 'error');
      return;
    }
    if (agent.status.busy) {
      agent.pushNotice('Still working — press Esc to abort first.', 'error');
      return;
    }
    agent.send(text);
  };

  return (
    <Box flexDirection="column">
      <Static items={agent.history}>{(item) => <MessageItem key={item.id} item={item} />}</Static>

      <Box flexDirection="column">
        {agent.history.length === 0 ? <Header envLabel={agent.envLabel} tier={tier} model={model} /> : null}

        {agent.live.map((item) => (
          <MessageItem key={item.id} item={item} />
        ))}

        {agent.startup ? (
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.toolError}>Failed to start sandbox: {agent.startup}</Text>
            <Text color={theme.muted}>
              Fix your config (~/.prometheus/config.json) or run: prometheus config
            </Text>
          </Box>
        ) : null}

        <StatusBar status={agent.status} tier={tier} model={model} />

        <Box>
          <Text color={theme.accent}>{agent.status.busy ? '… ' : '› '}</Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={onSubmit}
            placeholder={agent.ready ? 'Ask Prometheus, or /help' : 'starting sandbox…'}
          />
        </Box>
      </Box>
    </Box>
  );
}
