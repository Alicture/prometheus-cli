import { z } from 'zod';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

// Configuration directory: ~/.prometheus/config.json
export const CONFIG_DIR = join(homedir(), '.prometheus');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

// Model tiers mirror the SwiftUI app (Hermes/Athena/Zeus -> haiku/sonnet/opus).
export const TierSchema = z.enum(['hermes', 'athena', 'zeus']);
export type Tier = z.infer<typeof TierSchema>;

export const TIER_LABELS: Record<Tier, string> = {
  hermes: 'Hermes',
  athena: 'Athena',
  zeus: 'Zeus',
};

// Where to run tool commands: a Docker container, a remote SSH host, or
// directly on the local machine. This is the core "configurable environment".
export const EnvironmentSchema = z.enum(['docker', 'ssh', 'local']);
export type Environment = z.infer<typeof EnvironmentSchema>;

export const DockerConfigSchema = z.object({
  image: z.string().default('claude-sandbox'),
  memory: z.string().default('512m'),
  cpu: z.string().default('1'),
  workspace: z.string().default('/home/sandbox/workspace'),
  // Reuse an existing container instead of creating a fresh one.
  containerId: z.string().default(''),
  // Keep the container alive after exit instead of auto-removing it.
  persistent: z.boolean().default(false),
});

export const SSHConfigSchema = z.object({
  host: z.string().default(''),
  port: z.number().default(22),
  username: z.string().default('root'),
  privateKeyPath: z.string().default(''),
  password: z.string().default(''),
  workspace: z.string().default('~/workspace'),
});

export const LocalConfigSchema = z.object({
  workspace: z.string().default(process.cwd()),
});

export const ConfigSchema = z.object({
  // ---- LLM / Claude-compatible API ----
  apiKey: z.string().default(''),
  // Proxy / gateway base URL. Empty -> provider default.
  baseURL: z.string().default(''),
  // 'anthropic' = native Claude Messages API (/v1/messages, x-api-key).
  // 'openai'    = OpenAI-compatible chat completions (/v1/chat/completions).
  apiFormat: z.enum(['anthropic', 'openai']).default('anthropic'),
  anthropicVersion: z.string().default('2023-06-01'),

  // ---- Model tiers ----
  selectedTier: TierSchema.default('hermes'),
  modelHermes: z.string().default('claude-haiku-4-20250414'),
  modelAthena: z.string().default('claude-sonnet-4-20250514'),
  modelZeus: z.string().default('claude-opus-4-20250514'),

  // ---- Agent loop ----
  maxTurns: z.number().default(40),
  maxTokens: z.number().default(16384),
  maxOutputSize: z.number().default(100_000),
  commandTimeoutMs: z.number().default(120_000),

  // ---- Execution environment ----
  environment: EnvironmentSchema.default('docker'),
  docker: DockerConfigSchema.default({}),
  ssh: SSHConfigSchema.default({}),
  local: LocalConfigSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type DockerConfig = z.infer<typeof DockerConfigSchema>;
export type SSHConfig = z.infer<typeof SSHConfigSchema>;
export type LocalConfig = z.infer<typeof LocalConfigSchema>;

export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return defaultConfig();
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    // Parse with schema so missing fields get defaults (forward-compatible).
    return ConfigSchema.parse(raw);
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// Resolve the concrete model ID for the currently selected tier.
export function modelForTier(config: Config, tier: Tier = config.selectedTier): string {
  switch (tier) {
    case 'hermes':
      return config.modelHermes;
    case 'athena':
      return config.modelAthena;
    case 'zeus':
      return config.modelZeus;
  }
}

// Allow API key / base URL to come from the environment as a convenience.
// The explicit config value always wins; env vars are fallbacks. Several
// common aliases are accepted so existing Anthropic/proxy setups just work.
export function withEnvOverrides(config: Config): Config {
  const env = process.env;
  const firstNonEmpty = (...vals: (string | undefined)[]): string =>
    vals.find((v) => v && v.trim() !== '')?.trim() ?? '';

  const apiKey = config.apiKey || firstNonEmpty(
    env.ANTHROPIC_API_KEY,
    env.ANTHROPIC_AUTH_TOKEN,
    env.PROMETHEUS_API_KEY,
  );
  const baseURL = config.baseURL || firstNonEmpty(
    env.ANTHROPIC_BASE_URL,
    env.ANTHROPIC_API_URL,
    env.ANTHROPIC_API_BASE,
    env.PROMETHEUS_BASE_URL,
  );
  return { ...config, apiKey, baseURL };
}
