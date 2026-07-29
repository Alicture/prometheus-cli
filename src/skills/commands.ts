import { homedir } from 'node:os';
import { readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';
import { parseFrontmatter, asString, asList } from './frontmatter.js';
import {
  expandPath,
  isDir,
  pluginRoots,
  safeReaddir,
  tildify,
  type Skill,
} from './index.js';

// Claude Code exposes markdown files under `commands/` as slash commands: the
// file holds a prompt, and typing `/name` sends that prompt on the user's
// behalf. Subdirectories namespace the command, so
// `~/.claude/commands/gsd/add-phase.md` becomes `/gsd:add-phase`.
//
// The same files are read here, plus the `commands/` directory bundled inside a
// skill (namespaced under the skill's own name), so an installed skill's
// commands are usable straight away.

const CLAUDE_HOME = join(homedir(), '.claude');
const PROMETHEUS_HOME = join(homedir(), '.prometheus');

export type CommandSource = 'project' | 'prometheus' | 'user' | 'plugin' | 'extra' | 'skill';

const SOURCE_ORDER: CommandSource[] = ['project', 'prometheus', 'user', 'plugin', 'extra', 'skill'];

export interface CommandRoot {
  dir: string;
  source: CommandSource;
  label: string;
}

/** Filenames that name the command after their directory instead of themselves. */
const INDEX_FILES = new Set(['skill.md', 'index.md', 'command.md', 'readme.md']);

export interface PromptCommand {
  /** Invocation name without the leading slash, e.g. "gsd:add-phase". */
  name: string;
  description: string;
  /** Claude Code `argument-hint`, shown in autocomplete. */
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  /** Prompt body, with the frontmatter stripped. */
  body: string;
  path: string;
  source: CommandSource;
  /** Human-readable origin, e.g. "~/.claude/commands". */
  origin: string;
  /** Name of the skill that bundles this command, when it came from one. */
  skill?: string;
}

export interface CommandDiscoveryOptions {
  cwd?: string;
  dir?: string;
  /** Also scan ~/.claude and ~/.agents command directories. Default true. */
  includeClaude?: boolean;
  extraPaths?: string[];
  /** Command names to hide. */
  disabled?: string[];
  /** Skills whose bundled `commands/` directories should be scanned. */
  skills?: Skill[];
}

/** All roots scanned for prompt commands, in precedence order. */
export function commandRoots(options: CommandDiscoveryOptions = {}): CommandRoot[] {
  const cwd = options.cwd ?? process.cwd();
  const dir = options.dir ?? join(PROMETHEUS_HOME, 'commands');
  const roots: CommandRoot[] = [
    { dir: join(cwd, '.claude', 'commands'), source: 'project', label: '.claude/commands' },
    { dir: join(cwd, '.agents', 'commands'), source: 'project', label: '.agents/commands' },
    { dir, source: 'prometheus', label: tildify(dir) },
  ];
  if (options.includeClaude !== false) {
    roots.push({ dir: join(CLAUDE_HOME, 'commands'), source: 'user', label: '~/.claude/commands' });
    roots.push({ dir: join(homedir(), '.agents', 'commands'), source: 'user', label: '~/.agents/commands' });
    roots.push(...pluginRoots('commands'));
  }
  for (const extra of options.extraPaths ?? []) {
    const full = expandPath(extra, cwd);
    roots.push({ dir: full, source: 'extra', label: tildify(full) });
  }
  return roots.filter((root, i, all) => all.findIndex((r) => r.dir === root.dir) === i);
}

/** Every markdown file under `root`, relative to it. */
function findCommandFiles(root: string, maxDepth = 4): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    for (const entry of safeReaddir(dir)) {
      if (entry.startsWith('.')) continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(full, depth + 1);
      else if (extname(entry).toLowerCase() === '.md') out.push(full);
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Derive the invocation name from a file's location under its root:
 * `gsd/add-phase.md` -> `gsd:add-phase`, and `gsd/debug/SKILL.md` -> `gsd:debug`
 * (an index-style filename names the command after its directory).
 */
function derivedName(root: string, file: string): string {
  const rel = relative(root, file);
  const parts = rel.split(sep);
  const last = parts.pop() ?? '';
  if (!INDEX_FILES.has(last.toLowerCase())) {
    parts.push(basename(last, extname(last)));
  }
  return parts
    .map((p) => p.trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean)
    .join(':');
}

/** First prose line of a body, used when there is no `description`. */
function firstLine(body: string, max = 120): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('<!--')) continue;
    return line.length > max ? line.slice(0, max - 1) + '…' : line;
  }
  return '';
}

export function readCommandFile(
  file: string,
  root: string,
  source: CommandSource,
  origin: string,
  prefix = '',
): PromptCommand | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(raw);
  const derived = derivedName(root, file);
  // A frontmatter name is authoritative (Claude Code files often carry the
  // fully-qualified "plugin:command" form), but it must not escape the prefix.
  const declared = asString(data.name)?.trim().toLowerCase().replace(/\s+/g, '-');
  let name = declared || derived;
  if (prefix && !name.startsWith(`${prefix}:`)) name = `${prefix}:${name}`;
  if (!name) return null;

  return {
    name,
    description: asString(data.description)?.trim() || firstLine(body),
    argumentHint: asString(data['argument-hint'])?.trim() || asString(data.args)?.trim(),
    allowedTools: asList(data['allowed-tools']) ?? asList(data.tools),
    model: asString(data.model)?.trim(),
    body: body.trim(),
    path: file,
    source,
    origin,
    skill: prefix || undefined,
  };
}

/**
 * Split a command line into shell-like positional arguments, honouring quotes so
 * `$1` receives `two words` from `/cmd "two words"`.
 */
export function splitArgs(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

/**
 * Substitute Claude Code's argument placeholders. `$ARGUMENTS` receives the full
 * argument string and `$1`…`$9` the positional ones; when a command uses no
 * placeholder at all, arguments are appended so they are never silently lost.
 */
export function expandCommand(command: PromptCommand, args: string): string {
  const trimmed = args.trim();
  const positional = splitArgs(trimmed);
  // A positional must not be followed by a word character or a dot, so prose
  // like "costs $5.00" or an identifier "$1abc" is left alone.
  const POSITIONAL = /\$([1-9])(?![\w.])/g;
  const usesArguments = /\$ARGUMENTS\b/.test(command.body);
  const usesPositional = new RegExp(POSITIONAL.source).test(command.body);

  let out = command.body;
  if (usesArguments) out = out.replace(/\$ARGUMENTS\b/g, trimmed);
  if (usesPositional) out = out.replace(POSITIONAL, (_, d: string) => positional[Number(d) - 1] ?? '');
  if (!usesArguments && !usesPositional && trimmed) {
    out += `\n\nArguments: ${trimmed}`;
  }
  return out.trim();
}

export class CommandManager {
  private options: CommandDiscoveryOptions;

  constructor(options: CommandDiscoveryOptions = {}) {
    this.options = options;
  }

  /** Replace the skill list whose bundled commands are scanned. */
  setSkills(skills: Skill[]): void {
    this.options = { ...this.options, skills };
  }

  roots(): CommandRoot[] {
    return commandRoots(this.options);
  }

  /** Roots that exist on disk, with their command counts. */
  rootStatus(): Array<CommandRoot & { exists: boolean; count: number }> {
    const out = this.roots().map((root) => ({
      ...root,
      exists: isDir(root.dir),
      count: isDir(root.dir) ? findCommandFiles(root.dir).length : 0,
    }));
    for (const skill of this.options.skills ?? []) {
      const dir = join(skill.path, 'commands');
      if (!isDir(dir)) continue;
      out.push({
        dir,
        source: 'skill',
        label: `${tildify(dir)} (skill: ${skill.name})`,
        exists: true,
        count: findCommandFiles(dir).length,
      });
    }
    return out;
  }

  /** All discovered commands, de-duplicated by name using source precedence. */
  list(): PromptCommand[] {
    const disabled = new Set((this.options.disabled ?? []).map((n) => n.toLowerCase()));
    const byName = new Map<string, PromptCommand>();

    const add = (cmd: PromptCommand | null): void => {
      if (!cmd) return;
      const key = cmd.name.toLowerCase();
      if (disabled.has(key)) return;
      const existing = byName.get(key);
      if (!existing || SOURCE_ORDER.indexOf(cmd.source) < SOURCE_ORDER.indexOf(existing.source)) {
        byName.set(key, cmd);
      }
    };

    for (const root of this.roots()) {
      if (!isDir(root.dir)) continue;
      for (const file of findCommandFiles(root.dir)) {
        add(readCommandFile(file, root.dir, root.source, root.label));
      }
    }

    // Commands bundled inside a skill are namespaced under the skill's name.
    for (const skill of this.options.skills ?? []) {
      const dir = join(skill.path, 'commands');
      if (!isDir(dir)) continue;
      const prefix = skill.name.trim().toLowerCase().replace(/\s+/g, '-');
      for (const file of findCommandFiles(dir)) {
        add(readCommandFile(file, dir, 'skill', `skill: ${skill.name}`, prefix));
      }
    }

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): PromptCommand | undefined {
    const target = name.trim().toLowerCase();
    return this.list().find((c) => c.name.toLowerCase() === target);
  }
}

export function createCommandManager(
  config?: { skills?: { includeClaude?: boolean; paths?: string[]; disabled?: string[] } },
  skills: Skill[] = [],
): CommandManager {
  return new CommandManager({
    includeClaude: config?.skills?.includeClaude,
    extraPaths: config?.skills?.paths,
    disabled: config?.skills?.disabled,
    skills,
  });
}
