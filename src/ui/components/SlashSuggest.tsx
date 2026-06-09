import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

export interface SlashCommand {
  name: string;
  args?: string;
  desc: string;
}

export function SlashSuggest({
  suggestions,
  selected,
}: {
  suggestions: SlashCommand[];
  selected: number;
}) {
  if (suggestions.length === 0) return null;
  return (
    <Box flexDirection="column">
      {suggestions.map((c, i) => {
        const isSel = i === selected;
        return (
          <Box key={c.name}>
            <Text color={isSel ? theme.accent : theme.muted}>{isSel ? '❯ ' : '  '}</Text>
            <Text color={isSel ? theme.assistant : theme.muted}>
              /{c.name}
              {c.args ? ` ${c.args}` : ''}
            </Text>
            <Text color={theme.muted}>  {c.desc}</Text>
          </Box>
        );
      })}
      <Text color={theme.muted}>  ↑↓ select · Tab complete</Text>
    </Box>
  );
}
