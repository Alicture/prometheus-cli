import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import { useTerminalWidth } from '../hooks/useTerminalSize.js';

export interface SlashCommand {
  name: string;
  args?: string;
  desc: string;
}

export function SlashSuggest({
  suggestions,
  selected,
  hidden = 0,
}: {
  suggestions: SlashCommand[];
  selected: number;
  /** Number of further matches not shown, so the user knows to keep typing. */
  hidden?: number;
}) {
  const width = useTerminalWidth();
  if (suggestions.length === 0) return null;
  // Each row must stay on one line: a wrapped row would break the height budget
  // that keeps the prompt on screen.
  const labels = suggestions.map((c) => `/${c.name}${c.args ? ` ${c.args}` : ''}`);
  const labelWidth = Math.max(...labels.map((l) => l.length));
  const descWidth = Math.max(12, width - labelWidth - 6);
  return (
    <Box flexDirection="column">
      {suggestions.map((c, i) => {
        const isSel = i === selected;
        return (
          <Box key={c.name}>
            <Text color={isSel ? theme.accent : theme.muted}>{isSel ? '❯ ' : '  '}</Text>
            <Text color={isSel ? theme.assistant : theme.muted}>{labels[i].padEnd(labelWidth)}</Text>
            <Text color={theme.muted}>  {clamp(c.desc, descWidth)}</Text>
          </Box>
        );
      })}
      <Text color={theme.muted}>
        {'  ↑↓ select · Tab complete'}
        {hidden > 0 ? ` · +${hidden} more, keep typing` : ''}
      </Text>
    </Box>
  );
}

function clamp(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, Math.max(1, max - 1)) + '…' : flat;
}
