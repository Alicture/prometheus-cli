// Frontmatter parsing for Claude Code compatible SKILL.md files.
//
// Supports the subset of YAML that Agent Skills use in practice:
//   key: value                 scalars (optionally quoted)
//   key: [a, b, c]             inline flow sequences
//   key:                       block sequences ("- item" lines)
//     - a
//   key: >                     folded / literal block scalars
//   key: |
//   key:                       one level of nested mapping (metadata:)
//     sub: value
export type FrontmatterValue = string | string[] | Record<string, string>;

export interface Frontmatter {
  data: Record<string, FrontmatterValue>;
  body: string;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseInlineList(value: string): string[] {
  return value
    .slice(1, -1)
    .split(',')
    .map((part) => stripQuotes(part))
    .filter(Boolean);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

export function parseFrontmatter(content: string): Frontmatter {
  const data: Record<string, FrontmatterValue> = {};
  const normalized = content.replace(/^\uFEFF/, '');
  if (!/^---\r?\n/.test(normalized)) return { data, body: normalized };

  const close = normalized.search(/\r?\n---[ \t]*(\r?\n|$)/);
  if (close === -1) return { data, body: normalized };

  const header = normalized.slice(normalized.indexOf('\n') + 1, close);
  const after = normalized.slice(close + 1);
  const bodyStart = after.indexOf('\n');
  const body = bodyStart === -1 ? '' : after.slice(bodyStart + 1);

  const lines = header.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (indentOf(line) > 0) continue; // consumed by a parent key below

    const match = line.match(/^([A-Za-z_][\w.-]*):[ \t]*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const raw = match[2].trim();

    // Block scalar: gather indented continuation lines.
    if (raw === '>' || raw === '|' || raw === '>-' || raw === '|-') {
      const collected: string[] = [];
      while (i + 1 < lines.length && (!lines[i + 1].trim() || indentOf(lines[i + 1]) > 0)) {
        collected.push(lines[++i].trim());
      }
      const joined = raw.startsWith('|') ? collected.join('\n') : collected.join(' ');
      data[key] = joined.trim();
      continue;
    }

    if (raw.startsWith('[') && raw.endsWith(']')) {
      data[key] = parseInlineList(raw);
      continue;
    }

    if (raw === '') {
      // Either a block sequence or a nested mapping.
      const items: string[] = [];
      const nested: Record<string, string> = {};
      while (i + 1 < lines.length && (!lines[i + 1].trim() || indentOf(lines[i + 1]) > 0)) {
        const next = lines[++i];
        const trimmed = next.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('- ')) {
          items.push(stripQuotes(trimmed.slice(2)));
          continue;
        }
        const sub = trimmed.match(/^([A-Za-z_][\w.-]*):[ \t]*(.*)$/);
        if (sub) nested[sub[1]] = stripQuotes(sub[2]);
      }
      if (items.length > 0) data[key] = items;
      else if (Object.keys(nested).length > 0) data[key] = nested;
      else data[key] = '';
      continue;
    }

    data[key] = stripQuotes(raw);
  }

  return { data, body };
}

export function asString(value: FrontmatterValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value || undefined;
  if (Array.isArray(value)) return value.join(', ') || undefined;
  return undefined;
}

export function asList(value: FrontmatterValue | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.length ? value : undefined;
  if (typeof value === 'string') {
    const items = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return items.length ? items : undefined;
  }
  return undefined;
}

export function asRecord(value: FrontmatterValue | undefined): Record<string, string> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return undefined;
}
