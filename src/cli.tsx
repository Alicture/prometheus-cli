#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import meow from 'meow';
import {
  CONFIG_PATH,
  loadConfig,
  saveConfig,
  withEnvOverrides,
  defaultConfig,
  modelForTier,
  setModelForTier,
  TierSchema,
  TIER_LABELS,
  ALL_TIERS,
} from './config/index.js';
import { setConfigKey, flattenConfig } from './config/cli.js';
import { createSkillManager } from './skills/index.js';
import { createCommandManager } from './skills/commands.js';
import { App } from './ui/App.js';

const cli = meow(
  `
  Prometheus — agentic coding in your terminal, in a configurable Docker or remote sandbox.

  Usage
    $ prometheus                       start the interactive TUI
    $ prometheus config                show current configuration
    $ prometheus config init           write a default config file
    $ prometheus config set <k> <v>    set a config value (dotted keys supported)
    $ prometheus models                list model tiers and their IDs
    $ prometheus models use <tier>     set the active tier
    $ prometheus models set <t> <id>   set the model ID for a tier
    $ prometheus skill list            list available skills (all sources)
    $ prometheus skill install <repo>  install skills from GitHub (owner/repo[/subdir][#ref])
    $ prometheus skill search <repo>   list the skills a repo provides (no install)
    $ prometheus skill info <name>     show a skill's details
    $ prometheus skill dirs            show every directory scanned for skills
    $ prometheus skill host [name…]    list/set skills that run on the host, not the sandbox
    $ prometheus skill remove <name>   remove an installed skill
    $ prometheus commands [filter]     list slash commands (from commands/ dirs and skills)
    $ prometheus commands dirs         show every directory scanned for commands

  Config keys (examples)
    apiKey                 your Claude-compatible API key
    baseURL                proxy / gateway base URL (empty = provider default)
    apiFormat              anthropic | openai
    selectedTier           hermes | athena | zeus
    environment            docker | ssh | local
    docker.image           sandbox image (default: claude-sandbox)
    docker.containerId     reuse an existing container
    ssh.host               remote host for the ssh environment
    ssh.username           remote user
    ssh.privateKeyPath     path to a private key
    ssh.workspace          remote working directory

  Config file: ${CONFIG_PATH}
`,
  {
    importMeta: import.meta,
    flags: {},
  },
);

async function main() {
  const [command, ...rest] = cli.input;

  if (command === 'skill' || command === 'skills') {
    const skills = createSkillManager(loadConfig());
    const sub = rest[0];

    if (sub === 'install' || sub === 'add') {
      const args = rest.slice(1).filter(Boolean);
      const spec = args[0];
      if (!spec) {
        console.error('Usage: prometheus skill install <owner/repo[/subdir][#ref]> [skill-name…]');
        process.exit(1);
      }
      try {
        console.log(`Installing skills from ${spec}…`);
        const installed = await skills.install(spec, args.slice(1));
        console.log(`Installed ${installed.length} skill(s) into ${skills.installDir}:\n`);
        for (const s of installed) {
          console.log(`  ${s.name}\n    ${s.description || '(no description)'}`);
        }
      } catch (err) {
        console.error(`Install failed: ${(err as Error).message}`);
        process.exit(1);
      }
      return;
    }

    if (sub === 'search' || sub === 'preview') {
      const spec = rest.slice(1).join(' ').trim();
      if (!spec) {
        console.error('Usage: prometheus skill search <owner/repo[/subdir][#ref]>');
        process.exit(1);
      }
      try {
        const names = await skills.preview(spec);
        console.log(`${names.length} skill(s) in ${spec}:\n`);
        for (const n of names) console.log(`  ${n}`);
        console.log(`\nInstall all:  prometheus skill install ${spec}`);
        if (names[0]) console.log(`Install one:  prometheus skill install ${spec} ${names[0]}`);
      } catch (err) {
        console.error(`Search failed: ${(err as Error).message}`);
        process.exit(1);
      }
      return;
    }

    if (sub === 'info' || sub === 'show') {
      const name = rest.slice(1).join(' ').trim();
      const skill = skills.get(name);
      if (!skill) {
        console.error(`Skill not found: ${name}`);
        process.exit(1);
        return;
      }
      console.log(`${skill.name}`);
      console.log(`  description : ${skill.description || '(none)'}`);
      if (skill.version) console.log(`  version     : ${skill.version}`);
      if (skill.license) console.log(`  license     : ${skill.license}`);
      if (skill.allowedTools?.length) console.log(`  tools       : ${skill.allowedTools.join(', ')}`);
      console.log(`  source      : ${skill.source} (${skill.origin})`);
      console.log(`  path        : ${skill.path}`);
      if (skill.resources.length) {
        console.log(`  files       : ${skill.resources.slice(0, 10).join(', ')}`);
      }
      return;
    }

    if (sub === 'dirs' || sub === 'paths') {
      console.log('Skill search paths (highest precedence first):\n');
      for (const root of skills.rootStatus()) {
        const status = root.exists ? `${root.count} skill(s)` : 'missing';
        console.log(`  [${root.source}] ${root.label} — ${status}`);
      }
      console.log(`\nInstall target: ${skills.installDir}`);
      return;
    }

    if (sub === 'host') {
      const cfg = loadConfig();
      const names = rest.slice(1).filter(Boolean);
      if (names.length === 0) {
        const list = cfg.skills.hostSkills;
        console.log(
          list.length ? `Host-only skills: ${list.join(', ')}` : 'No host-only skills configured.',
        );
        console.log(
          '\nThese run on this machine (HostBash) instead of the sandbox — for skills that\n' +
            'drive local applications, CLIs or files a container cannot see.\n' +
            'Set with: prometheus skill host <name…>   (`none` clears the list)',
        );
        return;
      }
      const next = names.length === 1 && names[0] === 'none' ? [] : names;
      const unknown = next.filter((n) => !skills.get(n));
      if (unknown.length) {
        console.error(`Unknown skill(s): ${unknown.join(', ')}`);
        process.exit(1);
      }
      saveConfig(setConfigKey(cfg, 'skills.hostSkills', next.join(',')));
      console.log(next.length ? `Host-only skills: ${next.join(', ')}` : 'Host-only skills cleared.');
      return;
    }

    if (sub === 'remove' || sub === 'rm' || sub === 'uninstall') {
      const name = rest.slice(1).join(' ').trim();
      const result = skills.remove(name);
      console.log(result.ok ? `Removed: ${name}` : result.reason);
      if (!result.ok) process.exit(1);
      return;
    }

    // Default: list.
    const list = skills.list();
    if (list.length === 0) {
      console.log('No skills found. Add one with: prometheus skill install <owner/repo>');
      console.log('Claude Code skills in ~/.claude/skills are picked up automatically.');
      return;
    }
    console.log(`${list.length} skill(s) available:\n`);
    for (const s of list) {
      console.log(`  ${s.name}  [${s.source}]`);
      console.log(`    ${s.description || '(no description)'}`);
    }
    return;
  }

  if (command === 'models') {
    const sub = rest[0];
    const config = loadConfig();
    if (sub === 'use') {
      const parsed = TierSchema.safeParse(rest[1]);
      if (!parsed.success) {
        console.error('Usage: prometheus models use <hermes|athena|zeus>');
        process.exit(1);
      }
      config.selectedTier = parsed.data;
      saveConfig(config);
      console.log(`Active tier → ${TIER_LABELS[parsed.data]} (${modelForTier(config)})`);
      return;
    }
    if (sub === 'set') {
      const parsed = TierSchema.safeParse(rest[1]);
      const id = rest.slice(2).join(' ').trim();
      if (!parsed.success || !id) {
        console.error('Usage: prometheus models set <hermes|athena|zeus> <model-id>');
        process.exit(1);
      }
      setModelForTier(config, parsed.data, id);
      saveConfig(config);
      console.log(`${TIER_LABELS[parsed.data]} model → ${id}`);
      return;
    }
    // Default: list tiers.
    console.log('Model tiers:\n');
    for (const t of ALL_TIERS) {
      const active = t === config.selectedTier ? '●' : ' ';
      console.log(`  ${active} ${TIER_LABELS[t].padEnd(8)} ${modelForTier(config, t)}`);
    }
    console.log(`\nActive tier: ${TIER_LABELS[config.selectedTier]} · format: ${config.apiFormat}`);
    return;
  }

  if (command === 'commands' || command === 'command') {
    const config = loadConfig();
    const manager = createCommandManager(config, createSkillManager(config).list());
    const sub = rest[0];

    if (sub === 'dirs' || sub === 'paths') {
      console.log('Command search paths (highest precedence first):\n');
      for (const root of manager.rootStatus()) {
        const status = root.exists ? `${root.count} command(s)` : 'missing';
        console.log(`  [${root.source}] ${root.label} — ${status}`);
      }
      return;
    }

    const filter = (sub === 'list' ? rest.slice(1) : rest).join(' ').trim().toLowerCase();
    const all = manager
      .list()
      .filter((c) => !filter || c.name.toLowerCase().includes(filter) || c.description.toLowerCase().includes(filter));
    if (all.length === 0) {
      console.log(filter ? `No commands match "${filter}".` : 'No commands found. Try: prometheus commands dirs');
      return;
    }
    console.log(`${all.length} command(s)${filter ? ` matching "${filter}"` : ''}:\n`);
    for (const c of all) {
      console.log(`  /${c.name}${c.argumentHint ? ' ' + c.argumentHint : ''}`);
      console.log(`    ${c.description || '(no description)'}  [${c.source}]`);
    }
    return;
  }

  if (command === 'config') {
    const sub = rest[0];
    if (sub === 'init') {
      saveConfig(defaultConfig());
      console.log(`Wrote default config to ${CONFIG_PATH}`);
      return;
    }
    if (sub === 'set') {
      const key = rest[1];
      const value = rest.slice(2).join(' ');
      if (!key) {
        console.error('Usage: prometheus config set <key> <value>');
        process.exit(1);
      }
      try {
        const next = setConfigKey(loadConfig(), key, value);
        saveConfig(next);
        console.log(`Set ${key} = ${value}`);
      } catch (err) {
        console.error(`Invalid config: ${(err as Error).message}`);
        process.exit(1);
      }
      return;
    }
    // Default: print current config.
    const config = loadConfig();
    console.log(`Config: ${CONFIG_PATH}\n`);
    for (const [k, v] of flattenConfig(config)) {
      console.log(`  ${k.padEnd(22)} ${v}`);
    }
    return;
  }

  // Default command: launch the TUI.
  const config = withEnvOverrides(loadConfig());
  if (!config.apiKey) {
    console.error(
      'No API key configured.\n' +
        '  Set one with:  prometheus config set apiKey <your-key>\n' +
        '  Or export ANTHROPIC_API_KEY.\n',
    );
  }
  if (!process.stdin.isTTY) {
    console.error('Prometheus requires an interactive terminal (TTY).');
    process.exit(1);
  }

  const { waitUntilExit } = render(React.createElement(App, { config }));
  await waitUntilExit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
