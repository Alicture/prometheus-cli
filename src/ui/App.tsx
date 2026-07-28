import React, { useEffect, useState } from 'react';
import { Box, Text, Static, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Config, Tier } from '../config/index.js';
import {
  modelForTier,
  saveConfig,
  setModelForTier,
  EnvironmentSchema,
  PermissionModeSchema,
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
import { ApprovalPrompt } from './components/ApprovalPrompt.js';

// Catalog of slash commands used for autocomplete.
const COMMANDS: SlashCommand[] = [
  { name: 'help', desc: 'show help' },
  { name: 'model', args: '[tier]', desc: 'switch tier / open model picker' },
  { name: 'provider', args: '[key|url|format|...] <value>', desc: 'configure the LLM provider' },
  { name: 'skills', desc: 'list available skills (all sources)' },
  { name: 'skill', args: 'install <repo>', desc: 'install Claude Code skills from GitHub' },
  { name: 'env', args: '[local|docker|ssh]', desc: 'show or switch the execution environment' },
  { name: 'permissions', args: '[ask|auto|readonly]', desc: 'view or set the tool permission mode' },
  { name: 'clear', desc: 'clear the conversation' },
  { name: 'quit', desc: 'exit Prometheus' },
];

const HELP = [
  '/help                  show this help',
  '/model                 open the interactive model picker',
  '/model <tier>          switch tier: hermes | athena | zeus',
  '/model set <t> <id>    set the model ID for a tier',
  '/provider              show provider settings (key masked)',
  '/provider key <k>      set the API key',
  '/provider url <url>    set the base URL (empty = provider default)',
  '/provider format <f>   set API format: anthropic | openai',
  '/provider version <v>  set the anthropic-version header',
  '/provider clear key|url  unset the API key or base URL',
  '/skills                list available skills (all sources)',
  '/skill install <repo>  install skills from GitHub (owner/repo[/subdir][#ref]) [name…]',
  '/skill search <repo>   list the skills a repo provides (no install)',
  '/skill info <name>     show a skill\'s details',
  '/skill dirs            show every directory scanned for skills',
  '/skill reload          rescan skill directories',
  '/skill remove <name>   remove an installed skill',
  '/env                   show the current execution environment',
  '/env <local|docker|ssh>  switch environment and restart the sandbox',
  '/permissions           show the tool permission mode',
  '/permissions <mode>    set mode: ask | auto | readonly',
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
    if (!config.apiKey) {
      agent.pushNotice(
        'No API key configured. Set one with `/help` → or run ' +
          '`prometheus config set apiKey <key>` (or export ANTHROPIC_API_KEY / ' +
          'ANTHROPIC_AUTH_TOKEN). For a no-auth proxy, set a baseURL and leave the key empty.',
        'error',
      );
    }
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
    if (pickerOpen || agent.pendingApproval) return;
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
      const args = rest.slice(1).filter(Boolean);
      if (args.length === 0) {
        agent.pushNotice('Usage: /skill install <owner/repo[/subdir][#ref]> [skill-name…]', 'error');
        return;
      }
      void agent.installSkill(args[0], args.slice(1));
      return;
    }
    if (sub === 'search' || sub === 'preview') {
      const spec = rest.slice(1).join(' ').trim();
      if (!spec) {
        agent.pushNotice('Usage: /skill search <owner/repo>', 'error');
        return;
      }
      void agent.searchSkills(spec);
      return;
    }
    if (sub === 'info' || sub === 'show') {
      const name = rest.slice(1).join(' ').trim();
      const skill = agent.listSkills().find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (!skill) {
        agent.pushNotice(`Skill not found: ${name}`, 'error');
        return;
      }
      const lines = [
        `${skill.name}${skill.version ? ` (v${skill.version})` : ''}`,
        `  ${skill.description || '(no description)'}`,
        `  source: ${skill.source} — ${skill.origin}`,
        `  path:   ${skill.path}`,
      ];
      if (skill.allowedTools?.length) lines.push(`  tools:  ${skill.allowedTools.join(', ')}`);
      if (skill.resources.length) lines.push(`  files:  ${skill.resources.slice(0, 8).join(', ')}`);
      agent.pushNotice(lines.join('\n'));
      return;
    }
    if (sub === 'dirs' || sub === 'paths') {
      const lines = agent
        .skillDirs()
        .map((r) => `• [${r.source}] ${r.label} — ${r.exists ? `${r.count} skill(s)` : 'missing'}`);
      agent.pushNotice('Skill search paths (highest precedence first):\n' + lines.join('\n'));
      return;
    }
    if (sub === 'reload' || sub === 'refresh') {
      agent.refreshSkills();
      agent.pushNotice(`Reloaded skills (${agent.listSkills().length} available).`);
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
    agent.pushNotice(
      'Usage: /skill install <repo> [name…] | search <repo> | info <name> | dirs | reload | remove <name>',
      'error',
    );
  };

  const showSkills = () => {
    const list = agent.listSkills();
    if (list.length === 0) {
      agent.pushNotice(
        'No skills found. Add one with: /skill install <owner/repo>\n' +
          'Claude Code skills in ~/.claude/skills are picked up automatically (/skill dirs).',
      );
      return;
    }
    const lines = list.map(
      (s) => `• ${s.name} [${s.source}] — ${s.description || '(no description)'}`,
    );
    agent.pushNotice(`${list.length} skill(s) available:\n` + lines.join('\n'));
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

  const handleProviderCommand = (rest: string[]) => {
    const maskedKey = config.apiKey ? config.apiKey.slice(0, 3) + '••••' : '(none)';
    const sub = rest[0];
    if (!sub) {
      agent.pushNotice(
        `Provider settings:\n` +
          `• apiKey: ${maskedKey}\n` +
          `• baseURL: ${config.baseURL || '(provider default)'}\n` +
          `• apiFormat: ${config.apiFormat}\n` +
          `• anthropicVersion: ${config.anthropicVersion}\n` +
          `Use: /provider key <k> | url <url> | format <anthropic|openai> | version <v> | clear key|url`,
      );
      return;
    }
    const value = rest.slice(1).join(' ').trim();
    switch (sub) {
      case 'key':
      case 'apikey':
        if (!value) {
          agent.pushNotice('Usage: /provider key <api-key>', 'error');
          return;
        }
        config.apiKey = value;
        saveConfig(config);
        agent.refreshProvider();
        agent.pushNotice(`API key set (${value.slice(0, 3)}••••).`);
        break;
      case 'url':
      case 'baseurl':
        config.baseURL = value;
        saveConfig(config);
        agent.refreshProvider();
        agent.pushNotice(`Base URL → ${value || '(provider default)'}`);
        break;
      case 'format': {
        if (value !== 'anthropic' && value !== 'openai') {
          agent.pushNotice('Usage: /provider format <anthropic|openai>', 'error');
          return;
        }
        config.apiFormat = value;
        saveConfig(config);
        agent.refreshProvider();
        agent.pushNotice(`API format → ${value}`);
        break;
      }
      case 'version':
        if (!value) {
          agent.pushNotice('Usage: /provider version <anthropic-version>', 'error');
          return;
        }
        config.anthropicVersion = value;
        saveConfig(config);
        agent.refreshProvider();
        agent.pushNotice(`anthropic-version → ${value}`);
        break;
      case 'clear': {
        const target = value;
        if (target === 'key' || target === 'apikey') {
          config.apiKey = '';
        } else if (target === 'url' || target === 'baseurl') {
          config.baseURL = '';
        } else {
          agent.pushNotice('Usage: /provider clear <key|url>', 'error');
          return;
        }
        saveConfig(config);
        agent.refreshProvider();
        agent.pushNotice(`Cleared ${target}.`);
        break;
      }
      default:
        agent.pushNotice(
          'Usage: /provider [key <k>|url <url>|format <anthropic|openai>|version <v>|clear key|url]',
          'error',
        );
    }
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

  const handlePermissionsCommand = (rest: string[]) => {
    if (rest.length === 0) {
      agent.pushNotice(
        `Permission mode: ${config.permissions.mode}\n` +
          (config.permissions.allow.length
            ? `Always-allowed tools: ${config.permissions.allow.join(', ')}\n`
            : '') +
          `Set with: /permissions <ask|auto|readonly>\n` +
          `  ask      — prompt before each side-effecting tool (default)\n` +
          `  auto     — run every tool without prompting\n` +
          `  readonly — only read-only tools run; others are denied`,
      );
      return;
    }
    const parsed = PermissionModeSchema.safeParse(rest[0]);
    if (!parsed.success) {
      agent.pushNotice('Usage: /permissions <ask|auto|readonly>', 'error');
      return;
    }
    config.permissions.mode = parsed.data;
    saveConfig(config);
    agent.pushNotice(`Permission mode → ${parsed.data}`);
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
      case 'provider':
        handleProviderCommand(rest);
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
      case 'permissions':
      case 'perms':
        handlePermissionsCommand(rest);
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

        {agent.pendingApproval ? (
          <ApprovalPrompt request={agent.pendingApproval} onDecision={agent.resolveApproval} />
        ) : pickerOpen ? (
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
