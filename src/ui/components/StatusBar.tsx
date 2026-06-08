import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { theme } from '../theme.js';
import type { UIStatus } from '../types.js';

const SANDBOX_LABEL: Record<UIStatus['sandbox'], string> = {
  idle: 'idle',
  creating: 'starting',
  ready: 'ready',
  error: 'error',
};

export function StatusBar({
  status,
  tier,
  model,
}: {
  status: UIStatus;
  tier: string;
  model: string;
}) {
  const sandboxColor =
    status.sandbox === 'ready' ? theme.tool : status.sandbox === 'error' ? theme.toolError : theme.muted;
  const tokens = status.inputTokens + status.outputTokens;
  return (
    <Box marginTop={1} justifyContent="space-between">
      <Box>
        {status.busy ? (
          <Text color={theme.accent}>
            <Spinner type="dots" /> working…{' '}
          </Text>
        ) : (
          <Text color={theme.muted}>● </Text>
        )}
        <Text color={sandboxColor}>sandbox: {SANDBOX_LABEL[status.sandbox]}</Text>
      </Box>
      <Box>
        <Text color={theme.muted}>
          {tier}/{model} · {tokens.toLocaleString()} tok · ${status.costUSD.toFixed(4)}
        </Text>
      </Box>
    </Box>
  );
}
