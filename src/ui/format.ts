// Short one-line summary of a tool's input for the activity log.
export function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  switch (name) {
    case 'Bash':
      return s(input.command);
    case 'FileRead':
    case 'FileWrite':
    case 'FileEdit':
      return s(input.path);
    case 'Grep':
    case 'Glob':
      return s(input.pattern);
    default: {
      const json = JSON.stringify(input);
      return json.length > 80 ? json.slice(0, 80) + '…' : json;
    }
  }
}

export function previewLines(text: string, max = 8): string {
  const lines = text.split('\n');
  if (lines.length <= max) return text.trimEnd();
  return lines.slice(0, max).join('\n') + `\n  … (+${lines.length - max} more lines)`;
}
