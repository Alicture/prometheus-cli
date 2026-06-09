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
