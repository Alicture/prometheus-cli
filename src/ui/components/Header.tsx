import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';
import { Banner } from './Banner.js';

export function Header({ envLabel, tier, model }: { envLabel: string; tier: string; model: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Banner />
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.muted}>
          agentic coding in your terminal · {tier} ({model})
        </Text>
        <Text color={theme.muted}>environment: {envLabel}</Text>
      </Box>
    </Box>
  );
}
