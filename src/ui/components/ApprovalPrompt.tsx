import React from 'react';
import { Box, Text, useInput } from 'ink';
import { theme } from '../theme.js';
import type { ApprovalDecision, ApprovalRequest } from '../../types.js';

// Modal-style approval prompt shown before a side-effecting tool runs.
// Keys: a/↵ allow once · s allow for session · d/esc deny.
export function ApprovalPrompt({
  request,
  onDecision,
}: {
  request: ApprovalRequest;
  onDecision: (decision: ApprovalDecision) => void;
}) {
  useInput((input, key) => {
    if (key.return || input === 'a' || input === 'y') onDecision('allow');
    else if (input === 's' || input === 'A') onDecision('always');
    else if (key.escape || input === 'd' || input === 'n') onDecision('deny');
  });

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent} bold>
        Permission required
      </Text>
      <Text>
        <Text color={theme.tool}>{request.name}</Text>
        <Text color={theme.muted}> {request.summary}</Text>
      </Text>
      <Box marginTop={1}>
        <Text color={theme.muted}>
          <Text color={theme.assistant} bold>
            a
          </Text>
          /↵ allow once ·{' '}
          <Text color={theme.assistant} bold>
            s
          </Text>{' '}
          allow for session ·{' '}
          <Text color={theme.assistant} bold>
            d
          </Text>
          /esc deny
        </Text>
      </Box>
    </Box>
  );
}
