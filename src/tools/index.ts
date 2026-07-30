import type { ToolDefinition } from '../types.js';

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const Bash: ToolDefinition = {
  name: 'Bash',
  description:
    'Run a bash command in the sandbox working directory. Use for builds, tests, git, package managers, and general shell tasks.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash command to execute.' },
      timeout: { type: 'number', description: 'Optional timeout in seconds.' },
    },
    required: ['command'],
  },
  async run(input, ctx) {
    const command = String(input.command ?? '');
    const timeoutMs = input.timeout ? Number(input.timeout) * 1000 : undefined;
    const res = await ctx.exec(command, { timeoutMs });
    let out = res.stdout;
    if (res.stderr.trim()) out += (out ? '\n' : '') + res.stderr;
    if (res.exitCode !== 0) out += `\n[exit code ${res.exitCode}]`;
    return out.trim() || '(no output)';
  },
};

const FileRead: ToolDefinition = {
  name: 'FileRead',
  description: 'Read a file from the sandbox. Returns line-numbered content.',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      offset: { type: 'number', description: '1-based line to start from.' },
      limit: { type: 'number', description: 'Max number of lines to return.' },
    },
    required: ['path'],
  },
  async run(input, ctx) {
    const path = String(input.path ?? '');
    const content = await ctx.readFile(path);
    const lines = content.split('\n');
    const offset = input.offset ? Math.max(1, Number(input.offset)) : 1;
    const limit = input.limit ? Number(input.limit) : lines.length;
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    return slice.map((line, i) => `${String(offset + i).padStart(6)}\u2192${line}`).join('\n');
  },
};

const FileWrite: ToolDefinition = {
  name: 'FileWrite',
  description: 'Write (or overwrite) a file in the sandbox, creating parent directories as needed.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  },
  async run(input, ctx) {
    const path = String(input.path ?? '');
    const content = String(input.content ?? '');
    await ctx.writeFile(path, content);
    return `Wrote ${content.length} bytes to ${path}`;
  },
};

const FileEdit: ToolDefinition = {
  name: 'FileEdit',
  description:
    'Replace an exact string in a file with a new string. old_str must match exactly once.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_str: { type: 'string' },
      new_str: { type: 'string' },
    },
    required: ['path', 'old_str', 'new_str'],
  },
  async run(input, ctx) {
    const path = String(input.path ?? '');
    const oldStr = String(input.old_str ?? '');
    const newStr = String(input.new_str ?? '');
    const content = await ctx.readFile(path);
    const parts = content.split(oldStr);
    const matches = parts.length - 1;
    if (matches === 0) throw new Error(`old_str not found in ${path}`);
    if (matches > 1) throw new Error(`old_str matched ${matches} times in ${path}; make it unique`);
    await ctx.writeFile(path, parts.join(newStr));
    return `Edited ${path}`;
  },
};

const Grep: ToolDefinition = {
  name: 'Grep',
  description: 'Search file contents with ripgrep. Returns matching lines with file:line prefixes.',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string' },
      include: { type: 'string', description: 'Glob filter, e.g. "*.ts".' },
      context: { type: 'number', description: 'Lines of context around matches.' },
      caseSensitive: { type: 'boolean' },
    },
    required: ['pattern'],
  },
  async run(input, ctx) {
    const args = ['rg', '--line-number', '--no-heading'];
    if (!input.caseSensitive) args.push('-i');
    if (input.context) args.push('-C', String(Number(input.context)));
    if (input.include) args.push('-g', shellQuote(String(input.include)));
    args.push('-e', shellQuote(String(input.pattern)));
    if (input.path) args.push(shellQuote(String(input.path)));
    const res = await ctx.exec(args.join(' '));
    return res.stdout.trim() || '(no matches)';
  },
};

const Glob: ToolDefinition = {
  name: 'Glob',
  description: 'List files matching a glob pattern using ripgrep.',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string' },
    },
    required: ['pattern'],
  },
  async run(input, ctx) {
    const args = ['rg', '--files', '-g', shellQuote(String(input.pattern))];
    if (input.path) args.push(shellQuote(String(input.path)));
    const res = await ctx.exec(args.join(' '));
    return res.stdout.trim() || '(no files)';
  },
};

// Escape hatch for skills that can only work on this machine (host CLIs, GUI
// apps, local files). Added to the tool list only when such skills are
// configured and the sandbox is not already the host.
export const HostBash: ToolDefinition = {
  name: 'HostBash',
  description:
    'Run a bash command directly on the user\'s own machine, OUTSIDE the sandbox. Use this ' +
    'ONLY for skills the loaded skill instructions explicitly mark as host-only — those need ' +
    'CLIs, desktop apps or files that exist on the host and not in the sandbox. For every ' +
    'other command use Bash, which runs in the sandbox.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash command to execute on the host.' },
      timeout: { type: 'number', description: 'Optional timeout in seconds.' },
    },
    required: ['command'],
  },
  async run(input, ctx) {
    if (!ctx.execHost) {
      return 'HostBash is not available in this session.';
    }
    const command = String(input.command ?? '');
    const timeoutMs = input.timeout ? Number(input.timeout) * 1000 : undefined;
    const res = await ctx.execHost(command, { timeoutMs });
    let out = res.stdout;
    if (res.stderr.trim()) out += (out ? '\n' : '') + res.stderr;
    if (res.exitCode !== 0) out += `\n[exit code ${res.exitCode}]`;
    return out.trim() || '(no output)';
  },
};

export const allTools: ToolDefinition[] = [Bash, FileRead, FileWrite, FileEdit, Grep, Glob];

export function getToolByName(name: string): ToolDefinition | undefined {
  return allTools.find((t) => t.name === name);
}

export function getToolDefinitions(): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
  return allTools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}
