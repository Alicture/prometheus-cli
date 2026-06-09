import React, { useEffect, useState } from 'react';
import { Box, Text, Static, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Config, Tier } from '../config/index.js';
import {
  modelForTier,
  saveConfig,
  setModelForTier,
  TierSchema,
  TIER_LABELS,
  ALL_TIERS,
} from '../config/index.js';
import { theme } from './theme.js';
import { useAgent } from './hooks/useAgent.js';
import { Header } from './components/Header.js';
import { MessageItem } from './components/MessageItem.js';
import { StatusBar } from './components/StatusBar.js';
import { ModelPicker, type TierRow } from './components/ModelPicker.js';

const HELP = [
  '/help                 show this help',
  '/model                open the interactive model picker',
  '/model <tier>         switch tier: hermes | athena | zeus',
  '/model set <t> <id>   set the model ID for a tier',
  '/env                  show the current execution environment',
  '/clear                clear the conversation',
  '/quit                 exit Prometheus',
  '',
  'Esc aborts the current turn. Ctrl+C exits.',
].join('\n');

export function App({ config }: { config: Config }) {
  const { exit } = useApp();
  const agent = useAgent(config);
  const [input, setInput] = useState('');
  const [tier, setTier] = useState<Tier>(config.selectedTier);
  // Mirror tier model IDs in state so edits re-render the header/picker.
  const [models, setModels] = useState({
    hermes: config.modelHermes,
    athena: config.modelAthena,
    zeus: config.modelZeus,
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    void agent.begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const model = models[tier];

  useInput((_input, key) => {
    if (pickerOpen) return;
    if (key.escape && agent.status.busy) agent.abort();
  });

  const switchTier = (next: Tier) => {
    setTier(next);
    config.selectedTier = next;
    saveConfig(config);
    agent.pushNotice(`Model tier → ${TIER_LABELS[next]} (${models[next]})`);
  };

  const editModel = (target: Tier, modelId: string) => {
    setModelForTier(config, target, modelId);
    saveConfig(config);
    setModels((m) => ({ ...m, [target]: modelId }));
    agent.pushNotice(`${TIER_LABELS[target]} model → ${modelId}`);
  };

  const handleModelCommand = (rest: string[]) => {
    if (rest.length === 0) {
      setPickerOpen(true);
      return;
    }
    if (rest[0] === 'set') {
      const parsed = TierSchema.safeParse(rest[1]);
      const id = rest.slice(2).join(' ').trim();
      if (!parsed.success || !id) {
        agent.pushNotice('Usage: /model set <hermes|athena|zeus> <model-id>', 'error');
        return;
      }
      editModel(parsed.data, id);
      return;
    }
    const parsed = TierSchema.safeParse(rest[0]);
    if (!parsed.success) {
      agent.pushNotice('Usage: /model [tier] | /model set <tier> <id>', 'error');
      return;
    }
    switchTier(parsed.data);
  };

  const runCommand = (raw: string) => {
    const [cmd, ...rest] = raw.slice(1).trim().split(/\s+/);
    switch (cmd) {
      case 'help':
        agent.pushNotice('\n' + HELP);
        break;
      case 'model':
        handleModelCommand(rest);
        break;
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

        {pickerOpen ? (
          <ModelPicker
            rows={ALL_TIERS.map<TierRow>((t) => ({ tier: t, label: TIER_LABELS[t], modelId: models[t] }))}
            current={tier}
            onSwitch={switchTier}
            onEdit={editModel}
            onClose={() => setPickerOpen(false)}
          />
        ) : (
          <Box>
            <Text color={theme.accent}>{agent.status.busy ? '… ' : '› '}</Text>
            <TextInput
              value={input}
              onChange={setInput}
              onSubmit={onSubmit}
              placeholder={agent.ready ? 'Ask Prometheus, or /help' : 'starting sandbox…'}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
