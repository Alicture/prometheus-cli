import React, { useEffect, useMemo, useState } from 'react';
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
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { clampLiveItems } from './liveView.js';
import type { UIItem } from './types.js';

// Catalog of slash commands used for autocomplete.
const COMMANDS: SlashCommand[] = [
  { name: 'help', desc: 'show help' },
  { name: 'model', args: '[tier]', desc: 'switch tier / open model picker' },
  { name: 'provider', args: '[key|url|format|...] <value>', desc: 'configure the LLM provider' },
  { name: 'skills', desc: 'list available skills (all sources)' },
  { name: 'skill', args: 'install <repo>', desc: 'install Claude Code skills from GitHub' },
  { name: 'commands', args: '[filter]', desc: 'list slash commands from skills and Claude Code' },
  { name: 'env', args: '[local|docker|ssh] [image|container …]', desc: 'show or switch the execution environment' },
  { name: 'permissions', args: '[ask|auto|readonly]', desc: 'view or set the tool permission mode' },
  { name: 'clear', desc: 'clear the conversation' },
  { name: 'quit', desc: 'exit Prometheus' },
];

// Autocomplete is capped: hundreds of prompt commands can share a prefix.
const MAX_SUGGESTIONS = 8;

// `/commands` can match hundreds of entries; keep the listing readable.
const COMMAND_LIST_LIMIT = 60;

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

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
  '/skill host [add|rm] <name…>  run a skill on your machine, not in the sandbox',
  '/skill reload          rescan skill directories',
  '/skill remove <name>   remove an installed skill',
  '/commands [filter]     list prompt commands (from commands/ dirs and skills)',
  '/<skill> [request]     run an installed skill, e.g. /pdf merge a.pdf b.pdf',
  '/<name> [args]         run a prompt command, e.g. /gsd:add-phase auth',
  '/env                   show the current execution environment',
  '/env <local|docker|ssh>  switch environment and restart the sandbox',
  '/env docker image <image>      switch to docker with a specific image (must exist locally)',
  '/env docker container <name|id>  attach to an existing container (kept on exit; none to clear)',
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
  const { columns, rows } = useTerminalSize();
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

  // Every invocable name: built-ins first, then prompt commands from
  // `commands/` directories, then a command per installed skill.
  const allCommands = useMemo<SlashCommand[]>(() => {
    const seen = new Set(COMMANDS.map((c) => c.name.toLowerCase()));
    const out = [...COMMANDS];
    for (const c of agent.promptCommands) {
      if (seen.has(c.name.toLowerCase())) continue;
      seen.add(c.name.toLowerCase());
      out.push({ name: c.name, args: c.argumentHint, desc: c.description || `prompt command (${c.origin})` });
    }
    for (const s of agent.listSkills()) {
      const name = s.name.toLowerCase();
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name: s.name, args: '[request]', desc: s.description || `skill (${s.origin})` });
    }
    return out;
  }, [agent.promptCommands, agent.listSkills]);

  // Slash autocomplete: active while typing a command token (no space yet).
  const slashQuery =
    input.startsWith('/') && !input.includes(' ') ? input.slice(1).toLowerCase() : null;
  const matches =
    slashQuery !== null && !pickerOpen
      ? allCommands.filter((c) => c.name.toLowerCase().startsWith(slashQuery))
      : [];
  // Hundreds of commands can match, so only a screenful is offered.
  const suggestions = matches.slice(0, MAX_SUGGESTIONS);
  const hiddenSuggestions = matches.length - suggestions.length;
  // Hide the menu once the exact command is fully typed (e.g. "/help").
  const showSuggest =
    suggestions.length > 0 &&
    !(matches.length === 1 && suggestions[0].name.toLowerCase() === slashQuery);

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
        setInput(`/${pick.name} `);
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
      if (config.skills.hostSkills.some((n) => n.toLowerCase() === skill.name.toLowerCase())) {
        lines.push('  host:   host-only — runs on your machine via HostBash, not in the sandbox');
      }
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
    if (sub === 'host') {
      const args = rest.slice(1).filter(Boolean);
      const current = config.skills.hostSkills;
      if (args.length === 0) {
        agent.pushNotice(
          (current.length
            ? `Host-only skills: ${current.join(', ')}`
            : 'No host-only skills configured.') +
            '\nThese run on your machine (HostBash) instead of the sandbox — for skills that\n' +
            'drive local apps, CLIs or files a container cannot see.\n' +
            'Add:    /skill host add <name…>\n' +
            'Remove: /skill host remove <name…>  (or `none` to clear all)',
        );
        return;
      }
      const [op, ...names] = args;
      const known = agent.listSkills();
      const resolve = (n: string) => known.find((s) => s.name.toLowerCase() === n.toLowerCase())?.name ?? n;
      let next: string[];
      if (op === 'add') {
        if (names.length === 0) {
          agent.pushNotice('Usage: /skill host add <name…>', 'error');
          return;
        }
        const unknown = names.filter((n) => !known.some((s) => s.name.toLowerCase() === n.toLowerCase()));
        if (unknown.length) {
          agent.pushNotice(`Unknown skill(s): ${unknown.join(', ')}`, 'error');
          return;
        }
        next = [...new Set([...current, ...names.map(resolve)])];
      } else if (op === 'remove' || op === 'rm') {
        if (names.length === 0) {
          agent.pushNotice('Usage: /skill host remove <name…>  (or `none`)', 'error');
          return;
        }
        const drop = new Set(names.map((n) => n.toLowerCase()));
        next = drop.has('none') ? [] : current.filter((n) => !drop.has(n.toLowerCase()));
      } else {
        agent.pushNotice('Usage: /skill host [add|remove] <name…>', 'error');
        return;
      }
      config.skills.hostSkills = next;
      saveConfig(config);
      agent.refreshSkills();
      agent.pushNotice(
        next.length ? `Host-only skills: ${next.join(', ')}` : 'Host-only skills cleared.',
      );
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
      'Usage: /skill install <repo> [name…] | search <repo> | info <name> | dirs | host | reload | remove <name>',
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
    const ENV_USAGE =
      'Usage: /env <local|docker|ssh>\n' +
      '       /env docker image <image>\n' +
      '       /env docker container <name|id>';
    if (rest.length === 0) {
      const detail =
        config.environment === 'docker'
          ? (config.docker.containerId
              ? `Container: ${config.docker.containerId} (reused, kept on exit)`
              : `Image: ${config.docker.image} (fresh container)`) +
            ` · workdir: ${config.docker.workspace}\n`
          : config.environment === 'ssh'
            ? `Host: ${config.ssh.username}@${config.ssh.host || '(unset)'}\n`
            : `Workdir: ${config.local.workspace}\n`;
      agent.pushNotice(
        `Environment: ${agent.envLabel}\n` +
          detail +
          `API: ${config.apiFormat} · base URL: ${config.baseURL || '(provider default)'}\n` +
          `Switch with:      /env <local|docker|ssh>\n` +
          `Pick an image:    /env docker image <image>\n` +
          `Reuse container:  /env docker container <name|id>  (none to clear)`,
      );
      return;
    }
    const parsed = EnvironmentSchema.safeParse(rest[0]);
    if (!parsed.success) {
      agent.pushNotice(ENV_USAGE, 'error');
      return;
    }

    // `/env docker …` switches and picks what to run against in one step: an
    // image to spin a throwaway container from, or an existing container to
    // attach to (which is then never removed on exit).
    const args = rest.slice(1);
    let image = '';
    let container: string | null = null; // null = leave as configured
    if (args.length > 0) {
      if (parsed.data !== 'docker') {
        agent.pushNotice('An image or container can only be given for the docker environment.', 'error');
        return;
      }
      const [head, ...tail] = args;
      const value = tail.join(' ').trim();
      if (head === 'container') {
        if (!value) {
          agent.pushNotice('Usage: /env docker container <name|id>  (none to clear)', 'error');
          return;
        }
        container = /^(none|off|clear)$/i.test(value) ? '' : value;
      } else if (head === 'image') {
        if (!value) {
          agent.pushNotice('Usage: /env docker image <image>', 'error');
          return;
        }
        image = value;
      } else {
        image = args.join(' ').trim();
      }
    }
    // A configured container always wins over the image, so choosing an image
    // has to detach first or it would silently have no effect.
    if (image) {
      config.docker.image = image;
      config.docker.containerId = '';
    }
    if (container !== null) config.docker.containerId = container;

    config.environment = parsed.data;
    saveConfig(config);
    const what = image
      ? ` (image: ${image})`
      : container
        ? ` (container: ${container})`
        : container === ''
          ? ' (detached from container)'
          : '';
    agent.pushNotice(`Environment → ${parsed.data}${what}. Restarting sandbox…`);
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
      case 'commands':
        showCommands(rest);
        break;
      case 'quit':
      case 'exit':
        exit();
        break;
      default:
        runSkillOrPromptCommand(cmd, raw);
    }
  };

  // Anything that is not a built-in resolves against the discovered prompt
  // commands and then the installed skills, so `/gsd:add-phase` and `/pdf` work
  // the same way they do in Claude Code.
  const runSkillOrPromptCommand = (cmd: string, raw: string) => {
    // Take the arguments from the raw line so quoting and spacing survive.
    const args = raw.slice(1).trim().slice(cmd.length).trim();

    const command = agent.promptCommands.find((c) => c.name.toLowerCase() === cmd.toLowerCase());
    if (command) {
      if (!agent.ready) {
        agent.pushNotice('Sandbox is not ready yet.', 'error');
        return;
      }
      if (agent.status.busy) {
        agent.pushNotice('Still working — press Esc to abort first.', 'error');
        return;
      }
      agent.runPromptCommand(command, args);
      return;
    }

    const skill = agent.listSkills().find((s) => s.name.toLowerCase() === cmd.toLowerCase());
    if (skill) {
      if (!agent.ready) {
        agent.pushNotice('Sandbox is not ready yet.', 'error');
        return;
      }
      if (agent.status.busy) {
        agent.pushNotice('Still working — press Esc to abort first.', 'error');
        return;
      }
      agent.runSkill(skill, args);
      return;
    }

    const near = allCommands
      .filter((c) => c.name.toLowerCase().startsWith(cmd.toLowerCase().slice(0, 3)))
      .slice(0, 5)
      .map((c) => `/${c.name}`);
    agent.pushNotice(
      `Unknown command: /${cmd}` + (near.length ? `\nDid you mean: ${near.join('  ')}` : ''),
      'error',
    );
  };

  const showCommands = (rest: string[]) => {
    if (rest[0] === 'dirs') {
      const lines = agent
        .commandDirs()
        .map((r) => `  ${r.exists ? String(r.count).padStart(4) : '   -'}  ${r.source.padEnd(10)} ${r.label}`);
      agent.pushNotice(`Command directories:\n${lines.join('\n')}`);
      return;
    }
    if (rest[0] === 'reload') {
      agent.refreshSkills();
      agent.pushNotice('Reloaded skills and commands.');
      return;
    }

    const filter = rest.join(' ').trim().toLowerCase();
    const all = agent.promptCommands.filter(
      (c) => !filter || c.name.toLowerCase().includes(filter) || c.description.toLowerCase().includes(filter),
    );
    if (all.length === 0) {
      agent.pushNotice(
        filter ? `No commands match "${filter}".` : 'No prompt commands found. Try /commands dirs.',
      );
      return;
    }
    const shown = all.slice(0, COMMAND_LIST_LIMIT);
    const width = Math.max(...shown.map((c) => c.name.length + (c.argumentHint?.length ?? 0) + 1));
    const lines = shown.map((c) => {
      const label = `/${c.name}${c.argumentHint ? ' ' + c.argumentHint : ''}`;
      return `  ${label.padEnd(width + 1)}  ${truncate(c.description, 70)}`;
    });
    const more = all.length > shown.length ? `\n  … and ${all.length - shown.length} more` : '';
    agent.pushNotice(
      `${all.length} command(s)${filter ? ` matching "${filter}"` : ''}:\n${lines.join('\n')}${more}`,
    );
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

  const header = <Header envLabel={agent.envLabel} tier={tier} model={model} />;

  // The banner lives in <Static> so it stays in scrollback instead of being
  // redrawn (and eventually dropped) with the live region.
  const staticItems = useMemo<UIItem[]>(
    () => [{ id: '__header__', kind: 'header' }, ...agent.history],
    [agent.history],
  );

  // Reserve rows for everything rendered below the live region, then show only
  // the tail of the live output that still fits. This keeps the redrawn region
  // smaller than the terminal, so Ink can always erase it and the prompt stays
  // on screen. Heights below are measured, not guessed.
  const reserved =
    2 + // StatusBar (top margin + line)
    1 + // input line
    1 + // "⋮ streaming" indicator, shown whenever we clamp
    (agent.startup ? 3 : 0) +
    (agent.pendingApproval
      ? 7
      : pickerOpen
        ? ALL_TIERS.length + 4
        : showSuggest
          ? suggestions.length + (hiddenSuggestions > 0 ? 2 : 1)
          : 0) +
    2; // breathing room so a wrapped prompt never overflows
  const liveBudget = Math.max(3, rows - reserved);
  const liveView = clampLiveItems(agent.live, columns, liveBudget);

  return (
    <Box flexDirection="column">
      <Static items={staticItems}>
        {(item) => <MessageItem key={item.id} item={item} header={header} />}
      </Static>

      <Box flexDirection="column">
        {liveView.truncated ? (
          <Text color={theme.muted}>⋮ (streaming — full output appears above when done)</Text>
        ) : null}

        {liveView.items.map((item) => (
          <MessageItem key={item.id} item={item} plain />
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
              <SlashSuggest
                suggestions={suggestions}
                selected={Math.min(suggestIndex, suggestions.length - 1)}
                hidden={hiddenSuggestions}
              />
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
