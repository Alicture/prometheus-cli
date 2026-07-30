import type { ToolDefinition } from '../types.js';
import type { SkillManager, Skill } from '../skills/index.js';

const MAX_BODY = 24_000;

/** How a loaded skill's bundled files can be reached from the running session. */
export interface SkillPlacement {
  /** Directory the model should use when reading or running bundled files. */
  path: string;
  /** True when that directory lives on the host, not in the sandbox. */
  onHost: boolean;
  /** Set when the skill is marked host-only and must not use the sandbox. */
  hostOnly?: boolean;
  /** Set when the files could not be copied into the sandbox. */
  error?: string;
}

/** Resolves where a skill's files live for the current environment. */
export type SkillPreparer = (skill: Skill) => Promise<SkillPlacement>;

function renderSkill(skill: Skill, place: SkillPlacement): string {
  const head: string[] = [`# Skill: ${skill.name}`];
  const meta: string[] = [];
  if (skill.version) meta.push(`version ${skill.version}`);
  if (skill.license) meta.push(`license ${skill.license}`);
  meta.push(`source ${skill.origin}`);
  head.push(`_${meta.join(' · ')}_`);
  if (skill.description) head.push(`\n${skill.description}`);

  const body =
    skill.body.length > MAX_BODY
      ? `${skill.body.slice(0, MAX_BODY)}\n\n…(truncated — read ${place.path}/SKILL.md for the rest)`
      : skill.body;

  const sections = [head.join('\n'), '---', body];

  if (skill.allowedTools?.length) {
    sections.push(`Tools this skill expects: ${skill.allowedTools.join(', ')}`);
  }

  // Bundled files are only usable if the model is told where they actually are
  // for the environment its tools run in, and which tool can reach them.
  const runner = place.hostOnly ? 'HostBash' : 'Bash';
  if (place.hostOnly) {
    sections.push(
      [
        `IMPORTANT: "${skill.name}" is marked host-only. It depends on commands, applications ` +
          'or files that exist on the user\'s own machine and are not present in the sandbox.',
        'Run every command for this skill with the HostBash tool, not Bash.',
        'FileRead / FileWrite / Grep / Glob address the sandbox, so they cannot see these ' +
          'files either — use HostBash (cat, ls, …) to read them.',
      ].join(' '),
    );
  } else if (place.error) {
    sections.push(
      `NOTE: this skill's bundled files could not be copied into the sandbox (${place.error}). ` +
        `They are on the host at ${skill.path} and are not reachable from Bash.`,
    );
  }

  sections.push(
    `Base directory for this skill${place.onHost ? ' (on the host)' : ' (in the sandbox)'}: ${place.path}`,
  );
  if (skill.resources.length > 0) {
    sections.push(
      [
        `Bundled files (run them with ${runner}${place.hostOnly ? '' : ' / read them with FileRead'} as needed):`,
        ...skill.resources.map((r) => `  - ${place.path}/${r}`),
      ].join('\n'),
    );
  }
  return sections.join('\n\n');
}

// Builds a "Skill" tool the model can call to load a skill's full instructions
// into context on demand. Skills are surfaced by name + description in the
// system prompt and expanded here (progressive disclosure), matching how
// Claude Code Agent Skills work.
export function makeSkillTool(
  skills: SkillManager,
  prepare?: SkillPreparer,
  hostSkills: string[] = [],
): ToolDefinition {
  const hostOnly = new Set(hostSkills.map((n) => n.toLowerCase()));
  return {
    name: 'Skill',
    description:
      'Load the full instructions for an available skill by name. Call this when a task ' +
      'matches an available skill, then follow the returned instructions. Omit the name to ' +
      'list every available skill.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The skill name to load. Omit to list all skills.' },
      },
      required: [],
    },
    async run(input) {
      const name = String(input.name ?? '').trim();
      const all = skills.list();
      if (!name) {
        if (all.length === 0) return 'No skills are available.';
        return [
          'Available skills:',
          ...all.map(
            (s) =>
              `  - ${s.name}${hostOnly.has(s.name.toLowerCase()) ? ' [host-only — use HostBash]' : ''}: ` +
              `${s.description || '(no description)'}`,
          ),
        ].join('\n');
      }
      const skill = skills.get(name);
      if (!skill) {
        const available = all.map((s) => s.name).join(', ') || '(none)';
        return `Unknown skill: ${name}. Available skills: ${available}`;
      }
      const place = prepare
        ? await prepare(skill)
        : { path: skill.path, onHost: true };
      return renderSkill(skill, place);
    },
  };
}
