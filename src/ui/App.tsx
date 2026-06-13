import React, { useEffect, useState } from 'react';
import { Box, Text, Static, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Config, Tier } from '../config/index.js';
import {
  modelForTier,
  saveConfig,
  setModelForTier,
  EnvironmentSchema,
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
import { SlashSuggest, type SlashCommand } from './components/SlashSuggest.js';

// Catalog of slash commands used for autocomplete.
const COMMANDS: SlashCommand[] = [
  { name: 'help', desc: 'show help' },
  { name: 'model', args: '[tier]', desc: 'switch tier / open model picker' },
  { name: 'skills', desc: 'list installed skills' },
  { name: 'skill', args: 'install <repo>', desc: 'install a skill from GitHub' },
  { name: 'env', args: '[local|docker|ssh]', desc: 'show or switch the execution environment' },
  { name: 'docker', args: '[on|off|host <url>]', desc: 'configure / switch to the Docker sandbox' },
  { name: 'clear', desc: 'clear the conversation' },
  { name: 'quit', desc: 'exit Prometheus' },
];

const HELP = [
  '/help                  show this help',
  '/model                 open the interactive model picker',
  '/model <tier>          switch tier: hermes | athena | zeus',
  '/model set <t> <id>    set the model ID for a tier',
  '/skills                list installed skills',
  '/skill install <repo>  install a skill from GitHub (owner/repo[/subdir][#ref])',
  '/skill remove <name>   remove an installed skill',
  '/env                   show the current execution environment',
  '/env <local|docker|ssh>  switch environment and restart the sandbox',
  '/docker                show Docker settings',
  '/docker on             switch to the Docker sandbox',
  '/docker off            switch to local execution',
  '/docker host <url>     set the Docker daemon endpoint (DOCKER_HOST) + restart',
  '/docker image <name>   set the sandbox image',
  '/clear                 clear the conversation',
  '/quit                  exit Prometheus',
  '',
  'Type "/" for command autocomplete (↑↓ select, Tab complete).',
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
  const [suggestIndex, setSuggestIndex] = useState(0);

  useEffect(() => {
    void agent.begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const model = models[tier];

  // Slash autocomplete: active while typing a command token (no space yet).
  const slashQuery =
    input.startsWith('/') && !input.includes(' ') ? input.slice(1).toLowerCase() : null;
  const suggestions =
    slashQuery !== null && !pickerOpen
      ? COMMANDS.filter((c) => c.name.startsWith(slashQuery))
      : [];
  // Hide the menu once the exact command is fully typed (e.g. "/help").
  const showSuggest =
    suggestions.length > 0 && !(suggestions.length === 1 && suggestions[0].name === slashQuery);

  useInput((_input, key) => {
    if (pickerOpen) return;
    // Slash-command autocomplete navigation.
    if (showSuggest) {
      if (key.upArrow) {
        setSuggestIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (key.downArrow) {
        setSuggestIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (key.tab) {
        const pick = suggestions[Math.min(suggestIndex, suggestions.length - 1)];
        const completion = pick.args ? `/${pick.name} ` : `/${pick.name} `;
        setInput(completion);
        setSuggestIndex(0);
        return;
      }
    }
    if (key.escape && agent.status.busy) agent.abort();
  });

  const onInputChange = (value: string) => {
    setInput(value);
    setSuggestIndex(0);
  };

  const handleSkillCommand = (rest: string[]) => {
    const sub = rest[0];
    if (sub === 'install' || sub === 'add') {
      const spec = rest.slice(1).join(' ').trim();
      if (!spec) {
        agent.pushNotice('Usage: /skill install <owner/repo[/subdir][#ref]>', 'error');
        return;
      }
      void agent.installSkill(spec);
      return;
    }
    if (sub === 'remove' || sub === 'rm') {
      const name = rest.slice(1).join(' ').trim();
      if (!name) {
        agent.pushNotice('Usage: /skill remove <name>', 'error');
        return;
      }
      agent.removeSkill(name);
      return;
    }
    agent.pushNotice('Usage: /skill install <repo> | /skill remove <name>', 'error');
  };

  const showSkills = () => {
    const list = agent.listSkills();
    if (list.length === 0) {
      agent.pushNotice('No skills installed. Add one with: /skill install <owner/repo>');
      return;
    }
    const lines = list.map((s) => `• ${s.name} — ${s.description || '(no description)'}`);
    agent.pushNotice('Installed skills:\n' + lines.join('\n'));
  };

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

  const handleEnvCommand = (rest: string[]) => {
    if (rest.length === 0) {
      agent.pushNotice(
        `Environment: ${agent.envLabel}\n` +
          `API: ${config.apiFormat} · base URL: ${config.baseURL || '(provider default)'}\n` +
          `Switch with: /env <local|docker|ssh>`,
      );
      return;
    }
    const parsed = EnvironmentSchema.safeParse(rest[0]);
    if (!parsed.success) {
      agent.pushNotice('Usage: /env <local|docker|ssh>', 'error');
      return;
    }
    config.environment = parsed.data;
    saveConfig(config);
    agent.pushNotice(`Environment → ${parsed.data}. Restarting sandbox…`);
    void agent.restart();
  };

  const handleDockerCommand = (rest: string[]) => {
    const sub = rest[0];
    if (!sub) {
      agent.pushNotice(
        `Docker settings:\n` +
          `• image: ${config.docker.image}\n` +
          `• host: ${config.docker.host || '(default socket / DOCKER_HOST)'}\n` +
          `• containerId: ${config.docker.containerId || '(none)'}\n` +
          `• persistent: ${config.docker.persistent}\n` +
          `Active environment: ${config.environment}\n` +
          `Use: /docker on | off | host <url> | image <name>`,
      );
      return;
    }
    switch (sub) {
      case 'on':
      case 'use':
        config.environment = 'docker';
        saveConfig(config);
        agent.pushNotice('Environment → docker. Restarting sandbox…');
        void agent.restart();
        break;
      case 'off':
      case 'local':
        config.environment = 'local';
        saveConfig(config);
        agent.pushNotice('Environment → local. Restarting sandbox…');
        void agent.restart();
        break;
      case 'host': {
        const url = rest.slice(1).join(' ').trim();
        if (!url) {
          agent.pushNotice('Usage: /docker host <DOCKER_HOST url, e.g. unix:///path/docker.sock>', 'error');
          return;
        }
        config.docker.host = url;
        config.environment = 'docker';
        saveConfig(config);
        agent.pushNotice(`docker.host → ${url}. Switching to docker and restarting…`);
        void agent.restart();
        break;
      }
      case 'image': {
        const name = rest.slice(1).join(' ').trim();
        if (!name) {
          agent.pushNotice('Usage: /docker image <image-name>', 'error');
          return;
        }
        config.docker.image = name;
        saveConfig(config);
        agent.pushNotice(`docker.image → ${name}`);
        break;
      }
      default:
        agent.pushNotice('Usage: /docker [on|off|host <url>|image <name>]', 'error');
    }
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
      case 'skills':
        showSkills();
        break;
      case 'skill':
        handleSkillCommand(rest);
        break;
      case 'env':
        handleEnvCommand(rest);
        break;
      case 'docker':
        handleDockerCommand(rest);
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
          <>
            {showSuggest ? (
              <SlashSuggest suggestions={suggestions} selected={Math.min(suggestIndex, suggestions.length - 1)} />
            ) : null}
            <Box>
              <Text color={theme.accent}>{agent.status.busy ? '… ' : '› '}</Text>
              <TextInput
                value={input}
                onChange={onInputChange}
                onSubmit={onSubmit}
                placeholder={agent.ready ? 'Ask Prometheus, or /help' : 'starting sandbox…'}
              />
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
