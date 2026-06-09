import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Tier } from '../../config/index.js';
import { theme } from '../theme.js';

export interface TierRow {
  tier: Tier;
  label: string;
  modelId: string;
}

export function ModelPicker({
  rows,
  current,
  onSwitch,
  onEdit,
  onClose,
}: {
  rows: TierRow[];
  current: Tier;
  onSwitch: (tier: Tier) => void;
  onEdit: (tier: Tier, modelId: string) => void;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState(() => Math.max(0, rows.findIndex((r) => r.tier === current)));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useInput((input, key) => {
    if (editing) {
      // While editing, only intercept Escape; TextInput handles the rest.
      if (key.escape) setEditing(false);
      return;
    }
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((c) => (c - 1 + rows.length) % rows.length);
    } else if (key.downArrow || input === 'j') {
      setCursor((c) => (c + 1) % rows.length);
    } else if (key.return) {
      onSwitch(rows[cursor].tier);
      onClose();
    } else if (input === 'e') {
      setDraft(rows[cursor].modelId);
      setEditing(true);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
      <Text color={theme.accent}>Model configuration</Text>
      {rows.map((row, i) => {
        const isCursor = i === cursor;
        const isActive = row.tier === current;
        const marker = isCursor ? '❯' : isActive ? '●' : ' ';
        const labelColor = isActive ? theme.tool : theme.assistant;
        return (
          <Box key={row.tier}>
            <Text color={isCursor ? theme.accent : theme.muted}>{marker} </Text>
            <Text color={labelColor}>{row.label.padEnd(8)}</Text>
            {editing && isCursor ? (
              <TextInput
                value={draft}
                onChange={setDraft}
                onSubmit={(v) => {
                  const next = v.trim();
                  if (next) onEdit(row.tier, next);
                  setEditing(false);
                }}
              />
            ) : (
              <Text color={theme.muted}>{row.modelId}</Text>
            )}
          </Box>
        );
      })}
      <Text color={theme.muted}>
        {editing ? '↵ save · esc cancel' : '↑↓ move · ↵ select tier · e edit model · esc close'}
      </Text>
    </Box>
  );
}
