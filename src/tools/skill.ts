import type { ToolDefinition } from '../types.js';
import type { SkillManager, Skill } from '../skills/index.js';

const MAX_BODY = 24_000;

function renderSkill(skill: Skill): string {
  const head: string[] = [`# Skill: ${skill.name}`];
  const meta: string[] = [];
  if (skill.version) meta.push(`version ${skill.version}`);
  if (skill.license) meta.push(`license ${skill.license}`);
  meta.push(`source ${skill.origin}`);
  head.push(`_${meta.join(' · ')}_`);
  if (skill.description) head.push(`\n${skill.description}`);

  const body =
    skill.body.length > MAX_BODY
      ? `${skill.body.slice(0, MAX_BODY)}\n\n…(truncated — read ${skill.path}/SKILL.md for the rest)`
      : skill.body;

  const sections = [head.join('\n'), '---', body];

  if (skill.allowedTools?.length) {
    sections.push(`Tools this skill expects: ${skill.allowedTools.join(', ')}`);
  }

  sections.push(`Base directory for this skill: ${skill.path}`);
  if (skill.resources.length > 0) {
    sections.push(
      [
        'Bundled files (read them with FileRead / run them with Bash as needed):',
        ...skill.resources.map((r) => `  - ${skill.path}/${r}`),
      ].join('\n'),
    );
  }
  return sections.join('\n\n');
}

// Builds a "Skill" tool the model can call to load a skill's full instructions
// into context on demand. Skills are surfaced by name + description in the
// system prompt and expanded here (progressive disclosure), matching how
// Claude Code Agent Skills work.
export function makeSkillTool(skills: SkillManager): ToolDefinition {
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
          ...all.map((s) => `  - ${s.name}: ${s.description || '(no description)'}`),
        ].join('\n');
      }
      const skill = skills.get(name);
      if (!skill) {
        const available = all.map((s) => s.name).join(', ') || '(none)';
        return `Unknown skill: ${name}. Available skills: ${available}`;
      }
      return renderSkill(skill);
    },
  };
}
