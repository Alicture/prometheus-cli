import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

export function Header({ envLabel, tier, model }: { envLabel: string; tier: string; model: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.accent} bold>
        ✶ PROMETHEUS
      </Text>
      <Text color={theme.muted}>
        agentic coding in your terminal · {tier} ({model})
      </Text>
      <Text color={theme.muted}>environment: {envLabel}</Text>
    </Box>
  );
}
