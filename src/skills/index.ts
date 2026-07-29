import { homedir, tmpdir } from 'node:os';
import { join, basename, relative, resolve, sep } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  cpSync,
  statSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseFrontmatter, asString, asList, asRecord } from './frontmatter.js';

export const PROMETHEUS_HOME = join(homedir(), '.prometheus');
export const SKILLS_DIR = join(PROMETHEUS_HOME, 'skills');
export const CLAUDE_HOME = join(homedir(), '.claude');

/** Where a skill was discovered. Determines precedence when names collide. */
export type SkillSource = 'project' | 'prometheus' | 'user' | 'plugin' | 'extra';

const SOURCE_ORDER: SkillSource[] = ['project', 'prometheus', 'user', 'plugin', 'extra'];

export interface SkillRoot {
  dir: string;
  source: SkillSource;
  label: string;
}

export interface Skill {
  name: string;
  description: string;
  /** Directory containing SKILL.md. */
  path: string;
  /** SKILL.md content below the frontmatter. */
  body: string;
  source: SkillSource;
  /** Human-readable origin, e.g. "~/.claude/skills". */
  origin: string;
  version?: string;
  license?: string;
  /** Claude Code `allowed-tools` (aka `tools`). */
  allowedTools?: string[];
  metadata?: Record<string, string>;
  /** Bundled files (references/scripts/assets/…) relative to `path`. */
  resources: string[];
}

export interface SkillDiscoveryOptions {
  /** Working directory used to locate project-level skills. */
  cwd?: string;
  /** Install target + primary root. */
  dir?: string;
  /** Also scan ~/.claude and ~/.agents skill directories. Default true. */
  includeClaude?: boolean;
  /** Extra roots to scan. */
  extraPaths?: string[];
  /** Skill names to hide. */
  disabled?: string[];
}

export function tildify(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

export function expandPath(p: string, cwd = process.cwd()): string {
  let out = p.trim();
  if (out === '~') out = homedir();
  else if (out.startsWith('~/')) out = join(homedir(), out.slice(2));
  return resolve(cwd, out);
}

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function safeReaddir(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
}

/**
 * Find every directory under `root` that holds a SKILL.md. Stops descending once
 * a SKILL.md is found so a skill's own subdirectories are treated as resources.
 */
export function findSkillDirs(root: string, maxDepth = 4): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || !isDir(dir)) return;
    if (existsSync(join(dir, 'SKILL.md'))) {
      found.push(dir);
      return;
    }
    for (const entry of safeReaddir(dir)) {
      if (entry.startsWith('.') && entry !== '.claude') continue;
      if (entry === 'node_modules') continue;
      walk(join(dir, entry), depth + 1);
    }
  };
  walk(root, 0);
  return found.sort();
}

/** List bundled files inside a skill directory (excluding SKILL.md itself). */
function listResources(dir: string, maxEntries = 60): string[] {
  const out: string[] = [];
  const walk = (current: string, depth: number) => {
    if (depth > 3 || out.length >= maxEntries) return;
    for (const entry of safeReaddir(current).sort()) {
      if (entry.startsWith('.')) continue;
      const full = join(current, entry);
      if (isDir(full)) {
        walk(full, depth + 1);
      } else {
        const rel = relative(dir, full).split(sep).join('/');
        if (rel === 'SKILL.md') continue;
        out.push(rel);
      }
      if (out.length >= maxEntries) return;
    }
  };
  walk(dir, 0);
  return out;
}

export function readSkillDir(dir: string, source: SkillSource = 'prometheus', origin = ''): Skill | null {
  const md = join(dir, 'SKILL.md');
  if (!existsSync(md)) return null;
  let content: string;
  try {
    content = readFileSync(md, 'utf8');
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(content);
  return {
    name: asString(data.name) || basename(dir),
    description: asString(data.description) || '',
    path: dir,
    body: body.trim(),
    source,
    origin: origin || tildify(dir),
    version: asString(data.version),
    license: asString(data.license),
    allowedTools: asList(data['allowed-tools']) ?? asList(data.tools),
    metadata: asRecord(data.metadata),
    resources: listResources(dir),
  };
}

/** Locate `skills/` directories inside installed Claude Code plugins. */
// Plugin roots of a given kind: every plugin's `skills` or `commands` directory.
export function pluginRoots(kind: 'skills' | 'commands'): SkillRoot[] {
  const roots: SkillRoot[] = [];
  const bases = ['marketplaces', 'cache', 'data', 'repos'].map((d) => join(CLAUDE_HOME, 'plugins', d));
  for (const base of bases) {
    if (!isDir(base)) continue;
    for (const owner of safeReaddir(base)) {
      const ownerDir = join(base, owner);
      if (!isDir(ownerDir)) continue;
      const candidates = [ownerDir, ...safeReaddir(ownerDir).map((e) => join(ownerDir, e))];
      for (const candidate of candidates) {
        const dir = join(candidate, kind);
        if (isDir(dir)) roots.push({ dir, source: 'plugin', label: tildify(dir) });
      }
    }
  }
  return roots;
}


/** All roots scanned for skills, in precedence order. */
export function skillRoots(options: SkillDiscoveryOptions = {}): SkillRoot[] {
  const cwd = options.cwd ?? process.cwd();
  const dir = options.dir ?? SKILLS_DIR;
  const includeClaude = options.includeClaude !== false;
  const roots: SkillRoot[] = [
    { dir: join(cwd, '.claude', 'skills'), source: 'project', label: '.claude/skills' },
    { dir: join(cwd, '.agents', 'skills'), source: 'project', label: '.agents/skills' },
    { dir, source: 'prometheus', label: tildify(dir) },
  ];
  if (includeClaude) {
    roots.push({ dir: join(CLAUDE_HOME, 'skills'), source: 'user', label: '~/.claude/skills' });
    roots.push({ dir: join(homedir(), '.agents', 'skills'), source: 'user', label: '~/.agents/skills' });
    roots.push(...pluginRoots('skills'));
  }
  for (const extra of options.extraPaths ?? []) {
    const full = expandPath(extra, cwd);
    roots.push({ dir: full, source: 'extra', label: tildify(full) });
  }
  return roots.filter((root, i, all) => all.findIndex((r) => r.dir === root.dir) === i);
}

export class SkillManager {
  private dir: string;
  private options: SkillDiscoveryOptions;

  constructor(dirOrOptions: string | SkillDiscoveryOptions = SKILLS_DIR) {
    this.options = typeof dirOrOptions === 'string' ? { dir: dirOrOptions } : dirOrOptions;
    this.dir = this.options.dir ?? SKILLS_DIR;
  }

  /** The directory new skills are installed into. */
  get installDir(): string {
    return this.dir;
  }

  roots(): SkillRoot[] {
    return skillRoots({ ...this.options, dir: this.dir });
  }

  /** Roots that actually exist on disk, with their skill counts. */
  rootStatus(): Array<SkillRoot & { exists: boolean; count: number }> {
    return this.roots().map((root) => ({
      ...root,
      exists: isDir(root.dir),
      count: isDir(root.dir) ? findSkillDirs(root.dir).length : 0,
    }));
  }

  /** All discovered skills, de-duplicated by name using source precedence. */
  list(): Skill[] {
    const disabled = new Set((this.options.disabled ?? []).map((n) => n.toLowerCase()));
    const byName = new Map<string, Skill>();
    for (const root of this.roots()) {
      if (!isDir(root.dir)) continue;
      for (const skillDir of findSkillDirs(root.dir)) {
        const skill = readSkillDir(skillDir, root.source, root.label);
        if (!skill) continue;
        const key = skill.name.toLowerCase();
        if (disabled.has(key) || disabled.has(basename(skillDir).toLowerCase())) continue;
        const existing = byName.get(key);
        if (!existing || SOURCE_ORDER.indexOf(skill.source) < SOURCE_ORDER.indexOf(existing.source)) {
          byName.set(key, skill);
        }
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): Skill | undefined {
    const target = name.trim().toLowerCase();
    const all = this.list();
    return (
      all.find((s) => s.name.toLowerCase() === target) ??
      all.find((s) => basename(s.path).toLowerCase() === target) ??
      all.find((s) => slugify(s.name) === slugify(target))
    );
  }

  /** Remove a skill. Only skills inside the install dir can be removed. */
  remove(name: string): { ok: boolean; reason?: string } {
    const skill = this.get(name);
    if (!skill) return { ok: false, reason: `Skill not found: ${name}` };
    if (!resolve(skill.path).startsWith(resolve(this.dir) + sep)) {
      return {
        ok: false,
        reason: `"${skill.name}" is provided by ${skill.origin} and is not managed by Prometheus.`,
      };
    }
    rmSync(skill.path, { recursive: true, force: true });
    return { ok: true };
  }

  // Parse an install spec. Supports:
  //   - GitHub shorthand: "owner/repo", "owner/repo/sub/dir"
  //   - Full GitHub URL: "https://github.com/owner/repo[/tree/ref/sub/dir]"
  //   - Any git URL: "https://…", "git@…", "file://…" (no subpath inference)
  //   - Local directory path
  // An optional "#ref" suffix selects a branch/tag.
  parseSpec(spec: string): {
    kind: 'github' | 'git' | 'local';
    url: string;
    subpath: string;
    ref?: string;
    owner?: string;
    repo?: string;
  } {
    let s = spec.trim();
    let ref: string | undefined;
    const hash = s.indexOf('#');
    if (hash !== -1) {
      ref = s.slice(hash + 1);
      s = s.slice(0, hash);
    }

    if (s.startsWith('~') || s.startsWith('/') || s.startsWith('./') || s.startsWith('../')) {
      return { kind: 'local', url: expandPath(s), subpath: '', ref };
    }

    const isGitHub = /^(https?:\/\/github\.com\/|github\.com\/)/.test(s);
    const looksLikeUrl = /^(https?:\/\/|git@|file:\/\/)/.test(s);
    if (looksLikeUrl && !isGitHub) {
      return { kind: 'git', url: s.replace(/\/$/, ''), subpath: '', ref };
    }

    s = s.replace(/^https?:\/\/github\.com\//, '').replace(/^github\.com\//, '');
    s = s.replace(/\.git$/, '').replace(/\/$/, '');

    // GitHub web forms: /tree/<ref>/<subdir> and /blob/<ref>/<subdir>
    const tree = s.match(/^([^/]+)\/([^/]+)\/(?:tree|blob)\/([^/]+)(?:\/(.*))?$/);
    if (tree) {
      return {
        kind: 'github',
        url: `https://github.com/${tree[1]}/${tree[2]}.git`,
        subpath: (tree[4] ?? '').replace(/\/SKILL\.md$/, ''),
        ref: ref ?? tree[3],
        owner: tree[1],
        repo: tree[2],
      };
    }

    const parts = s.split('/').filter(Boolean);
    if (parts.length < 2) {
      throw new Error(`Invalid skill spec: "${spec}" (expected owner/repo[/subdir][#ref])`);
    }
    return {
      kind: 'github',
      url: `https://github.com/${parts[0]}/${parts[1]}.git`,
      subpath: parts.slice(2).join('/').replace(/\/SKILL\.md$/, ''),
      ref,
      owner: parts[0],
      repo: parts[1],
    };
  }

  /** Download a GitHub repo tarball (no git binary required). */
  private async fetchTarball(owner: string, repo: string, ref: string | undefined, dest: string): Promise<void> {
    const refs = ref ? [ref] : ['HEAD', 'main', 'master'];
    let lastError = '';
    for (const candidate of refs) {
      const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${candidate}`;
      const res = await fetch(url);
      if (!res.ok) {
        lastError = `${res.status} ${res.statusText} (${url})`;
        continue;
      }
      const archive = join(dest, 'archive.tar.gz');
      writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
      execFileSync('tar', ['-xzf', archive, '-C', dest, '--strip-components', '1'], { stdio: 'pipe' });
      rmSync(archive, { force: true });
      return;
    }
    throw new Error(`Could not download ${owner}/${repo}: ${lastError}`);
  }

  private cloneWithGit(url: string, ref: string | undefined, dest: string): void {
    const args = ['clone', '--depth', '1'];
    if (ref) args.push('--branch', ref);
    args.push(url, dest);
    try {
      execFileSync('git', args, { stdio: 'pipe' });
    } catch (err) {
      const detail = (err as { stderr?: Buffer }).stderr?.toString().trim() || (err as Error).message;
      throw new Error(`git clone failed: ${detail}`);
    }
  }

  /**
   * Install skills from a GitHub repo, git URL, or local directory.
   * Discovers every SKILL.md in the tree (so Claude Code repos that keep skills
   * under `skills/` or inside a plugin all work). `only` filters by skill name.
   */
  async install(spec: string, only?: string[]): Promise<Skill[]> {
    const parsed = this.parseSpec(spec);
    const tmp = mkdtempSync(join(tmpdir(), 'prom-skill-'));
    try {
      let sourceRoot: string;
      if (parsed.kind === 'local') {
        sourceRoot = parsed.url;
        if (!isDir(sourceRoot)) throw new Error(`Not a directory: ${sourceRoot}`);
      } else if (parsed.kind === 'github') {
        try {
          await this.fetchTarball(parsed.owner!, parsed.repo!, parsed.ref, tmp);
        } catch (err) {
          // Fall back to git for private repos / custom auth setups.
          try {
            this.cloneWithGit(parsed.url, parsed.ref, join(tmp, 'repo'));
            cpSync(join(tmp, 'repo'), tmp, { recursive: true });
            rmSync(join(tmp, 'repo'), { recursive: true, force: true });
          } catch {
            throw err;
          }
        }
        sourceRoot = parsed.subpath ? join(tmp, parsed.subpath) : tmp;
      } else {
        this.cloneWithGit(parsed.url, parsed.ref, join(tmp, 'repo'));
        sourceRoot = join(tmp, 'repo');
      }

      if (!existsSync(sourceRoot)) {
        throw new Error(`Path "${parsed.subpath}" not found in ${parsed.url}`);
      }

      let skillDirs = findSkillDirs(sourceRoot, 5);
      if (skillDirs.length === 0) {
        throw new Error('No SKILL.md found in the source (searched up to 5 levels deep).');
      }

      if (only && only.length > 0) {
        const wanted = new Set(only.map((n) => slugify(n)));
        const filtered = skillDirs.filter((d) => {
          const skill = readSkillDir(d);
          return skill ? wanted.has(slugify(skill.name)) || wanted.has(slugify(basename(d))) : false;
        });
        if (filtered.length === 0) {
          const names = skillDirs.map((d) => readSkillDir(d)?.name ?? basename(d)).join(', ');
          throw new Error(`No matching skill for "${only.join(', ')}". Available: ${names}`);
        }
        skillDirs = filtered;
      }

      mkdirSync(this.dir, { recursive: true });
      const installed: Skill[] = [];
      for (const srcDir of skillDirs) {
        const skill = readSkillDir(srcDir);
        if (!skill) continue;
        const dest = join(this.dir, slugify(skill.name));
        rmSync(dest, { recursive: true, force: true });
        cpSync(srcDir, dest, { recursive: true });
        rmSync(join(dest, '.git'), { recursive: true, force: true });
        const saved = readSkillDir(dest, 'prometheus', tildify(this.dir));
        if (saved) installed.push(saved);
      }
      if (installed.length === 0) throw new Error('Nothing installed (no readable SKILL.md).');
      return installed;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** List skill names available in a source without installing them. */
  async preview(spec: string): Promise<string[]> {
    const parsed = this.parseSpec(spec);
    const tmp = mkdtempSync(join(tmpdir(), 'prom-skill-'));
    try {
      let sourceRoot = tmp;
      if (parsed.kind === 'local') {
        sourceRoot = parsed.url;
      } else if (parsed.kind === 'github') {
        await this.fetchTarball(parsed.owner!, parsed.repo!, parsed.ref, tmp);
        sourceRoot = parsed.subpath ? join(tmp, parsed.subpath) : tmp;
      } else {
        this.cloneWithGit(parsed.url, parsed.ref, join(tmp, 'repo'));
        sourceRoot = join(tmp, 'repo');
      }
      return findSkillDirs(sourceRoot, 5).map((d) => readSkillDir(d)?.name ?? basename(d));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** @deprecated use install() */
  async installFromGitHub(spec: string): Promise<string[]> {
    return (await this.install(spec)).map((s) => s.name);
  }
}

/** Build a SkillManager from the `skills` section of the config. */
export function createSkillManager(config?: {
  skills?: { includeClaude?: boolean; paths?: string[]; disabled?: string[] };
  local?: { workspace?: string };
}): SkillManager {
  return new SkillManager({
    dir: SKILLS_DIR,
    cwd: config?.local?.workspace || process.cwd(),
    includeClaude: config?.skills?.includeClaude !== false,
    extraPaths: config?.skills?.paths ?? [],
    disabled: config?.skills?.disabled ?? [],
  });
}
