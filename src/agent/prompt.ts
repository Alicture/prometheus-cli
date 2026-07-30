import type { Skill } from '../skills/index.js';

// Skill descriptions are the only skill content kept in every prompt
// (progressive disclosure), so cap them to keep the preamble bounded.
const MAX_DESC = 400;

export interface SystemPromptOptions {
  /** Skills that must run on the user's machine rather than in the sandbox. */
  hostSkills?: string[];
}

export function buildSystemPrompt(
  workdir: string,
  skills: Skill[] = [],
  opts: SystemPromptOptions = {},
): string {
  const hostSkills = opts.hostSkills ?? [];
  const lines = [
    'You are Prometheus, an agentic coding assistant running in a terminal.',
    'You help the user with software engineering tasks by reading and writing files and running commands.',
    '',
    `You operate inside a sandboxed environment. The working directory is: ${workdir}`,
    'All file paths and shell commands execute inside this environment.',
    '',
    'Available tools:',
    '- Bash: run shell commands (builds, tests, git, package managers).',
    '- FileRead: read a file (line-numbered).',
    '- FileWrite: create or overwrite a file.',
    '- FileEdit: replace an exact unique string in a file.',
    '- Grep: search file contents with ripgrep.',
    '- Glob: find files by glob pattern.',
  ];

  if (hostSkills.length > 0) {
    lines.push(
      "- HostBash: run a command on the user's own machine, outside the sandbox. Use it ONLY " +
        `for these host-only skills: ${hostSkills.join(', ')}. Everything else uses Bash.`,
    );
  }

  if (skills.length > 0) {
    lines.push('- Skill: load full instructions for an available skill by name.');
    lines.push('');
    lines.push(
      `Available skills (${skills.length}). Each entry is a name + when to use it; call the ` +
        'Skill tool with the name to load its full instructions before acting on it:',
    );
    const isHostSkill = new Set(hostSkills.map((n) => n.toLowerCase()));
    for (const s of skills) {
      const desc = s.description || '(no description)';
      const trimmed = desc.length > MAX_DESC ? `${desc.slice(0, MAX_DESC).trimEnd()}…` : desc;
      const tag = isHostSkill.has(s.name.toLowerCase()) ? ' [host-only — use HostBash]' : '';
      lines.push(`- ${s.name}${tag}: ${trimmed}`);
    }
  }

  lines.push(
    '',
    'Guidelines:',
    '- Prefer using tools to inspect the actual state of the project before making changes.',
    '- When a task matches an available skill, load it with the Skill tool and follow its instructions.',
    '- Make minimal, correct changes. Verify your work by running tests or commands when possible.',
    '- Keep responses concise. Explain what you did, not what you are about to do.',
    '- When a task is complete, summarize the outcome briefly.',
  );
  return lines.join('\n');
}
