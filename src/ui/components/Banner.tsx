import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

// Pixel-art PROMETHEUS wordmark rendered with block glyphs.
const LINES = [
  '████ ████ ████ █   █ ████ █████ █  █ ████ █  █ ████',
  '█  █ █  █ █  █ ██ ██ █      █   █  █ █    █  █ █   ',
  '████ ████ █  █ █ █ █ ███    █   ████ ███  █  █ ████',
  '█    █ █  █  █ █   █ █      █   █  █ █    █  █    █',
  '█    █  █ ████ █   █ ████   █   █  █ ████ ████ ████',
];

// Top rows brighter, lower rows dimmer — a subtle orange gradient.
const SHADES = [theme.accentBright, theme.accent, theme.accent, theme.accentDim, theme.accentDim];

export function Banner() {
  return (
    <Box flexDirection="column">
      {LINES.map((line, i) => (
        <Text key={i} color={SHADES[i]} bold>
          {line}
        </Text>
      ))}
    </Box>
  );
}
