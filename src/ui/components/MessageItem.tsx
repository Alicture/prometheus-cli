import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { UIItem } from '../types.js';
import { summarizeToolInput, previewLines } from '../format.js';

export function MessageItem({ item }: { item: UIItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <Box marginTop={1}>
          <Text color={theme.user} bold>
            ›{' '}
          </Text>
          <Text color={theme.user}>{item.text}</Text>
        </Box>
      );

    case 'assistant':
      return (
        <Box marginTop={1}>
          <Text color={theme.assistant}>{item.text}</Text>
        </Box>
      );

    case 'notice':
      return (
        <Box marginTop={1}>
          <Text color={item.level === 'error' ? theme.toolError : theme.notice}>
            {item.level === 'error' ? '✗ ' : 'ℹ '}
            {item.text}
          </Text>
        </Box>
      );

    case 'tool': {
      const isError = item.status === 'error';
      const color = isError ? theme.toolError : theme.tool;
      const icon = item.status === 'running' ? '⟳' : isError ? '✗' : '●';
      const summary = summarizeToolInput(item.name, item.input);
      const dur = item.durationMs ? ` (${(item.durationMs / 1000).toFixed(1)}s)` : '';
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={color}>
            {icon} {item.name}
            <Text color={theme.muted}> {summary}{dur}</Text>
          </Text>
          {item.status !== 'running' && item.content ? (
            <Box marginLeft={2}>
              <Text color={theme.muted}>{previewLines(item.content)}</Text>
            </Box>
          ) : null}
        </Box>
      );
    }
  }
}
