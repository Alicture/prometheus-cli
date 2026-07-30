import { ConfigSchema, type Config } from './index.js';

// Coerce a string CLI value into boolean/number/string.
function coerce(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

// Set a dotted key (e.g. "docker.image", "ssh.host", "apiKey") on the config
// and re-validate. Returns the new validated config or throws on invalid key.
export function setConfigKey(config: Config, dottedKey: string, rawValue: string): Config {
  const parts = dottedKey.split('.');
  const draft: any = structuredClone(config);
  let cursor = draft;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cursor[parts[i]] === undefined || typeof cursor[parts[i]] !== 'object') {
      cursor[parts[i]] = {};
    }
    cursor = cursor[parts[i]];
  }
  const leaf = parts[parts.length - 1];
  // List-valued settings (skills.paths, permissions.allow, …) are given as a
  // comma- or space-separated string; an empty value clears them.
  const value = Array.isArray(cursor[leaf])
    ? rawValue.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    : coerce(rawValue);
  cursor[leaf] = value;
  return ConfigSchema.parse(draft);
}

// Flatten config into dotted key/value pairs for display, masking secrets.
export function flattenConfig(config: Config): [string, string][] {
  const rows: [string, string][] = [];
  const secret = new Set(['apiKey', 'ssh.password']);
  const walk = (obj: any, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, key);
      } else {
        let display = String(v);
        if (secret.has(key) && display) display = display.slice(0, 3) + '••••';
        rows.push([key, display]);
      }
    }
  };
  walk(config, '');
  return rows;
}
