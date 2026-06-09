import type { ToolDefinition } from '../types.js';
import type { SkillManager } from '../skills/index.js';

// Builds a "Skill" tool the model can call to load a skill's full instructions
// into context on demand (mirrors how agent skills are surfaced by name +
// description, then expanded when relevant).
export function makeSkillTool(skills: SkillManager): ToolDefinition {
  return {
    name: 'Skill',
    description:
      'Load the full instructions for an installed skill by name. Call this when a task ' +
      'matches an available skill, then follow the returned instructions.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The skill name to load.' },
      },
      required: ['name'],
    },
    async run(input) {
      const name = String(input.name ?? '');
      const skill = skills.get(name);
      if (!skill) {
        const available = skills.list().map((s) => s.name).join(', ') || '(none)';
        return `Unknown skill: ${name}. Installed skills: ${available}`;
      }
      return `# Skill: ${skill.name}\n\n${skill.body}\n\n(skill files are at: ${skill.path})`;
    },
  };
}
