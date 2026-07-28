import React from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import { theme } from '../theme.js';
import { parseMarkdown, type Block, type InlineSpan, type Align } from '../markdown.js';

// ---------------------------------------------------------------------------
// Inline spans
// ---------------------------------------------------------------------------

function Span({ span, color }: { span: InlineSpan; color?: string }) {
  const { styles } = span;
  if (styles.includes('code')) {
    return (
      <Text color={theme.code} backgroundColor={theme.codeBg}>
        {span.text}
      </Text>
    );
  }
  return (
    <Text
      color={styles.includes('link') ? theme.link : color}
      bold={styles.includes('bold')}
      italic={styles.includes('italic')}
      strikethrough={styles.includes('strike')}
      underline={styles.includes('link')}
    >
      {span.text}
    </Text>
  );
}

function Spans({ spans, color }: { spans: InlineSpan[]; color?: string }) {
  return (
    <Text>
      {spans.map((span, i) => (
        <Span key={i} span={span} color={color} />
      ))}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Table layout
// ---------------------------------------------------------------------------

const spansText = (spans: InlineSpan[]): string => spans.map((s) => s.text).join('');

/** Wrap spans to `width` display columns, returning per-line span slices. */
function wrapSpans(spans: InlineSpan[], width: number): InlineSpan[][] {
  const lines: InlineSpan[][] = [];
  let line: InlineSpan[] = [];
  let used = 0;

  const push = () => {
    lines.push(line.length ? line : [{ text: '', styles: [] }]);
    line = [];
    used = 0;
  };

  for (const span of spans) {
    // Split on spaces but keep them so words rejoin naturally.
    const words = span.text.split(/(\s+)/).filter((w) => w !== '');
    for (const word of words) {
      let w = word;
      if (/^\s+$/.test(w)) {
        if (used === 0) continue; // no leading whitespace on a wrapped line
        if (used + 1 > width) {
          push();
          continue;
        }
        line.push({ ...span, text: ' ' });
        used += 1;
        continue;
      }
      let ww = stringWidth(w);
      if (used > 0 && used + ww > width) push();
      // A single word longer than the column: hard-split it.
      while (ww > width) {
        let take = '';
        let taken = 0;
        for (const ch of w) {
          const cw = stringWidth(ch);
          if (taken + cw > width) break;
          take += ch;
          taken += cw;
        }
        line.push({ ...span, text: take });
        push();
        w = w.slice(take.length);
        ww = stringWidth(w);
      }
      if (w) {
        line.push({ ...span, text: w });
        used += ww;
      }
    }
  }
  if (line.length) push();
  return lines.length ? lines : [[{ text: '', styles: [] }]];
}

function pad(width: number, content: number, align: Align): [number, number] {
  const space = Math.max(0, width - content);
  if (align === 'right') return [space, 0];
  if (align === 'center') return [Math.floor(space / 2), Math.ceil(space / 2)];
  return [0, space];
}

function Cell({
  spans,
  width,
  align,
  color,
}: {
  spans: InlineSpan[];
  width: number;
  align: Align;
  color?: string;
}) {
  const lines = wrapSpans(spans, width);
  return (
    <Box flexDirection="column" width={width}>
      {lines.map((line, i) => {
        const [left, right] = pad(width, stringWidth(spansText(line)), align);
        return (
          <Text key={i}>
            {' '.repeat(left)}
            <Spans spans={line} color={color} />
            {' '.repeat(right)}
          </Text>
        );
      })}
    </Box>
  );
}

/**
 * Compute column widths: give every column its natural width when it fits,
 * otherwise shrink the widest columns until the table fits the terminal.
 */
function columnWidths(
  header: InlineSpan[][],
  rows: InlineSpan[][][],
  available: number,
): number[] {
  const cols = header.length;
  const natural: number[] = [];
  const minimum: number[] = [];

  for (let c = 0; c < cols; c++) {
    const cells = [header[c], ...rows.map((r) => r[c] ?? [])];
    let max = 1;
    let longestWord = 1;
    for (const cell of cells) {
      const text = spansText(cell);
      max = Math.max(max, stringWidth(text));
      for (const word of text.split(/\s+/)) {
        longestWord = Math.max(longestWord, Math.min(stringWidth(word), 24));
      }
    }
    natural.push(max);
    minimum.push(Math.min(max, Math.max(longestWord, 3)));
  }

  // Chrome: "│ " + " │ " between columns + " │"
  const chrome = 3 * cols + 1;
  const budget = Math.max(cols * 3, available - chrome);
  const widths = [...natural];
  let total = widths.reduce((a, b) => a + b, 0);

  while (total > budget) {
    // Shrink the currently widest shrinkable column.
    let target = -1;
    for (let c = 0; c < cols; c++) {
      if (widths[c] <= minimum[c]) continue;
      if (target === -1 || widths[c] > widths[target]) target = c;
    }
    if (target === -1) break;
    widths[target]--;
    total--;
  }
  return widths;
}

function Divider({ widths, kind }: { widths: number[]; kind: 'top' | 'mid' | 'bottom' }) {
  const [l, m, r] = kind === 'top' ? ['┌', '┬', '┐'] : kind === 'mid' ? ['├', '┼', '┤'] : ['└', '┴', '┘'];
  return (
    <Text color={theme.tableBorder}>
      {l}
      {widths.map((w) => '─'.repeat(w + 2)).join(m)}
      {r}
    </Text>
  );
}

function Row({
  cells,
  widths,
  align,
  color,
  bold,
}: {
  cells: InlineSpan[][];
  widths: number[];
  align: Align[];
  color?: string;
  bold?: boolean;
}) {
  const rendered = widths.map((w, c) => wrapSpans(cells[c] ?? [], w));
  const height = Math.max(...rendered.map((lines) => lines.length));
  const out: React.ReactNode[] = [];

  for (let line = 0; line < height; line++) {
    const parts: React.ReactNode[] = [];
    for (let c = 0; c < widths.length; c++) {
      const spans = rendered[c][line] ?? [{ text: '', styles: [] as never[] }];
      const [left, right] = pad(widths[c], stringWidth(spansText(spans)), align[c] ?? 'left');
      parts.push(
        <Text key={c}>
          <Text color={theme.tableBorder}>│ </Text>
          {' '.repeat(left)}
          {bold ? (
            <Text bold color={color}>
              {spansText(spans)}
            </Text>
          ) : (
            <Spans spans={spans} color={color} />
          )}
          {' '.repeat(right)}
          {' '}
        </Text>,
      );
    }
    out.push(
      <Text key={line}>
        {parts}
        <Text color={theme.tableBorder}>│</Text>
      </Text>,
    );
  }
  return <>{out}</>;
}

function Table({
  block,
  width,
  color,
  first,
}: {
  block: Extract<Block, { type: 'table' }>;
  width: number;
  color?: string;
  first: boolean;
}) {
  const widths = columnWidths(block.header, block.rows, width);
  const align = block.align.length === block.header.length
    ? block.align
    : block.header.map((_, i) => block.align[i] ?? 'left');

  return (
    <Box flexDirection="column" marginTop={first ? 0 : 1}>
      <Divider widths={widths} kind="top" />
      <Row cells={block.header} widths={widths} align={align} color={theme.accent} bold />
      <Divider widths={widths} kind="mid" />
      {block.rows.map((row, i) => (
        <Row key={i} cells={row} widths={widths} align={align} color={color} />
      ))}
      <Divider widths={widths} kind="bottom" />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const BULLETS = ['•', '◦', '-'];

function Blocks({
  blocks,
  width,
  color,
  depth = 0,
}: {
  blocks: Block[];
  width: number;
  color?: string;
  depth?: number;
}) {
  return (
    <>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} width={width} color={color} depth={depth} first={i === 0} />
      ))}
    </>
  );
}

function BlockView({
  block,
  width,
  color,
  depth,
  first,
}: {
  block: Block;
  width: number;
  color?: string;
  depth: number;
  first: boolean;
}) {
  switch (block.type) {
    case 'paragraph':
      return (
        <Box flexDirection="column" marginTop={first ? 0 : 1}>
          {block.lines.map((line, i) => (
            <Spans key={i} spans={line} color={color} />
          ))}
        </Box>
      );

    case 'heading': {
      const text = block.spans.map((s) => s.text).join('');
      return (
        <Box flexDirection="column" marginTop={first ? 0 : 1}>
          <Text bold color={block.level <= 2 ? theme.accent : theme.accentBright}>
            {text}
          </Text>
          {block.level <= 2 ? (
            <Text color={theme.accentDim}>
              {(block.level === 1 ? '━' : '─').repeat(Math.min(width, Math.max(4, stringWidth(text))))}
            </Text>
          ) : null}
        </Box>
      );
    }

    case 'code':
      return (
        <Box flexDirection="column" marginTop={first ? 0 : 1} paddingLeft={1} borderStyle="round" borderColor={theme.tableBorder}>
          {block.lang ? <Text color={theme.muted}>{block.lang}</Text> : null}
          {block.lines.map((line, i) => (
            <Text key={i} color={theme.code}>
              {line || ' '}
            </Text>
          ))}
        </Box>
      );

    case 'rule':
      return (
        <Box marginTop={first ? 0 : 1}>
          <Text color={theme.tableBorder}>{'─'.repeat(Math.max(4, Math.min(width, 60)))}</Text>
        </Box>
      );

    case 'quote':
      return (
        <Box marginTop={first ? 0 : 1} paddingLeft={1} borderStyle="single" borderColor={theme.muted}
             borderTop={false} borderRight={false} borderBottom={false}>
          <Box flexDirection="column">
            <Blocks blocks={block.blocks} width={Math.max(8, width - 2)} color={theme.muted} depth={depth} />
          </Box>
        </Box>
      );

    case 'list':
      return (
        <Box flexDirection="column" marginTop={first ? 0 : 1}>
          {block.items.map((item, i) => {
            const marker = block.ordered
              ? `${block.start + i}.`
              : item.checked === undefined
                ? BULLETS[depth % BULLETS.length]
                : item.checked
                  ? '[x]'
                  : '[ ]';
            return (
              <Box key={i} flexDirection="row">
                <Text color={theme.accentDim}>{marker} </Text>
                <Box flexDirection="column">
                  <Spans spans={item.spans} color={color} />
                  {item.children.length > 0 ? (
                    <Blocks
                      blocks={item.children}
                      width={Math.max(8, width - marker.length - 1)}
                      color={color}
                      depth={depth + 1}
                    />
                  ) : null}
                </Box>
              </Box>
            );
          })}
        </Box>
      );

    case 'table':
      return <Table block={block} width={width} color={color} first={first} />;
  }
}

/** Render a Markdown string as Ink elements. */
export function Markdown({
  text,
  width = 80,
  color,
}: {
  text: string;
  width?: number;
  color?: string;
}) {
  const blocks = React.useMemo(() => parseMarkdown(text), [text]);
  return (
    <Box flexDirection="column">
      <Blocks blocks={blocks} width={width} color={color} />
    </Box>
  );
}
