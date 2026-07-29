import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import type { UIItem } from '../types.js';
import { summarizeToolInput, previewLines } from '../format.js';
import { Markdown } from './Markdown.js';
import { useTerminalWidth } from '../hooks/useTerminalSize.js';

export function MessageItem({
  item,
  header,
  plain,
}: {
  item: UIItem;
  header?: React.ReactNode;
  /** Render text verbatim (used for the streaming region, where the rendered
   *  height must be predictable and markdown would reflow on every chunk). */
  plain?: boolean;
}) {
  const width = useTerminalWidth();
  switch (item.kind) {
    case 'header':
      return <>{header}</>;

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
          {plain ? (
            <Text color={theme.assistant}>{item.text}</Text>
          ) : (
            <Markdown text={item.text} width={Math.max(20, width - 2)} color={theme.assistant} />
          )}
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
