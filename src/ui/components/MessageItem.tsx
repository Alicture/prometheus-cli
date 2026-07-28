import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { UIItem } from '../types.js';
import { summarizeToolInput, previewLines } from '../format.js';
import { Markdown } from './Markdown.js';
import { useTerminalWidth } from '../hooks/useTerminalWidth.js';

export function MessageItem({ item }: { item: UIItem }) {
  const width = useTerminalWidth();
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
          <Markdown text={item.text} width={Math.max(20, width - 2)} color={theme.assistant} />
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
