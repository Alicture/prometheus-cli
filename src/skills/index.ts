import { homedir, tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  cpSync,
  statSync,
  mkdtempSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';

export const SKILLS_DIR = join(homedir(), '.prometheus', 'skills');

export interface Skill {
  name: string;
  description: string;
  path: string; // directory
  body: string; // SKILL.md content below frontmatter
}

// Minimal YAML-frontmatter parser (name + description only). Avoids a yaml dep.
function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  const data: Record<string, string> = {};
  if (!content.startsWith('---')) return { data, body: content };
  const end = content.indexOf('\n---', 3);
  if (end === -1) return { data, body: content };
  const header = content.slice(3, end).trim();
  const body = content.slice(content.indexOf('\n', end + 1) + 1);

  const lines = header.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let value = m[2].trim();
    // Folded/literal block scalars: gather following indented lines.
    if (value === '>' || value === '|') {
      const collected: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        collected.push(lines[++i].trim());
      }
      value = collected.join(' ');
    }
    value = value.replace(/^["']|["']$/g, '');
    data[key] = value;
  }
  return { data, body };
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
}

export class SkillManager {
  private dir: string;

  constructor(dir: string = SKILLS_DIR) {
    this.dir = dir;
  }

  private readSkillDir(dir: string): Skill | null {
    const md = join(dir, 'SKILL.md');
    if (!existsSync(md)) return null;
    const content = readFileSync(md, 'utf8');
    const { data, body } = parseFrontmatter(content);
    return {
      name: data.name || basename(dir),
      description: data.description || '',
      path: dir,
      body: body.trim(),
    };
  }

  list(): Skill[] {
    if (!existsSync(this.dir)) return [];
    const out: Skill[] = [];
    for (const entry of readdirSync(this.dir)) {
      const full = join(this.dir, entry);
      if (!statSync(full).isDirectory()) continue;
      const skill = this.readSkillDir(full);
      if (skill) out.push(skill);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): Skill | undefined {
    const target = name.toLowerCase();
    return this.list().find((s) => s.name.toLowerCase() === target || basename(s.path) === target);
  }

  remove(name: string): boolean {
    const skill = this.get(name);
    if (!skill) return false;
    rmSync(skill.path, { recursive: true, force: true });
    return true;
  }

  // Parse an install spec. Supports:
  //   - GitHub shorthand: "owner/repo", "owner/repo/sub/dir"
  //   - Full GitHub URL: "https://github.com/owner/repo[/tree/ref/sub/dir]"
  //   - Any git URL: "https://…", "git@…", "file://…" (no subpath inference)
  // An optional "#ref" suffix selects a branch/tag.
  private parseSpec(spec: string): { url: string; subpath: string; ref?: string } {
    let s = spec.trim();
    let ref: string | undefined;
    const hash = s.indexOf('#');
    if (hash !== -1) {
      ref = s.slice(hash + 1);
      s = s.slice(0, hash);
    }

    // Non-GitHub git URLs / local repos: use verbatim, no subpath.
    const isGitHub = /^(https?:\/\/github\.com\/|github\.com\/)/.test(s);
    const looksLikeUrl = /^(https?:\/\/|git@|file:\/\/|\/|\.\/)/.test(s);
    if (looksLikeUrl && !isGitHub) {
      return { url: s.replace(/\/$/, ''), subpath: '', ref };
    }

    s = s.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    // Support the GitHub web "/tree/<ref>/<subdir>" form.
    const tree = s.match(/^([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.*)$/);
    if (tree) {
      return {
        url: `https://github.com/${tree[1]}/${tree[2]}.git`,
        subpath: tree[4],
        ref: ref ?? tree[3],
      };
    }
    const parts = s.split('/').filter(Boolean);
    if (parts.length < 2) throw new Error(`Invalid GitHub spec: "${spec}" (expected owner/repo[/subdir])`);
    const url = `https://github.com/${parts[0]}/${parts[1]}.git`;
    const subpath = parts.slice(2).join('/');
    return { url, subpath, ref };
  }

  // Clone a GitHub repo (shallow) and install any SKILL.md-bearing directories.
  // Returns the names of installed skills.
  async installFromGitHub(spec: string): Promise<string[]> {
    const { url, subpath, ref } = this.parseSpec(spec);
    const tmp = mkdtempSync(join(tmpdir(), 'prom-skill-'));
    try {
      const args = ['clone', '--depth', '1'];
      if (ref) args.push('--branch', ref);
      args.push(url, tmp);
      execFileSync('git', args, { stdio: 'pipe' });

      const sourceDir = subpath ? join(tmp, subpath) : tmp;
      if (!existsSync(sourceDir)) throw new Error(`Path "${subpath}" not found in ${url}`);

      // Determine skill source directories.
      let skillDirs: string[];
      if (existsSync(join(sourceDir, 'SKILL.md'))) {
        skillDirs = [sourceDir];
      } else {
        skillDirs = readdirSync(sourceDir)
          .map((e) => join(sourceDir, e))
          .filter((p) => statSync(p).isDirectory() && existsSync(join(p, 'SKILL.md')));
      }
      if (skillDirs.length === 0) {
        throw new Error('No SKILL.md found in the repository (root or immediate subdirectories).');
      }

      mkdirSync(this.dir, { recursive: true });
      const installed: string[] = [];
      for (const srcDir of skillDirs) {
        const skill = this.readSkillDir(srcDir)!;
        const name = slugify(skill.name);
        const dest = join(this.dir, name);
        rmSync(dest, { recursive: true, force: true });
        cpSync(srcDir, dest, { recursive: true });
        rmSync(join(dest, '.git'), { recursive: true, force: true });
        installed.push(name);
      }
      return installed;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}
