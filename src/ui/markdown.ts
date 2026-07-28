// A small, dependency-light Markdown parser producing blocks the Ink renderer
// can lay out. Supports the subset LLM answers actually use: headings, fenced
// and indented code, tables, ordered/unordered (nested) lists, blockquotes,
// horizontal rules, and inline emphasis / code / links / strikethrough.

export type InlineStyle = 'bold' | 'italic' | 'code' | 'strike' | 'link';

export interface InlineSpan {
  text: string;
  styles: InlineStyle[];
  /** Present for links. */
  href?: string;
}

export type Align = 'left' | 'center' | 'right';

export type Block =
  | { type: 'paragraph'; lines: InlineSpan[][] }
  | { type: 'heading'; level: number; spans: InlineSpan[] }
  | { type: 'code'; lang?: string; lines: string[] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'table'; header: InlineSpan[][]; rows: InlineSpan[][][]; align: Align[] }
  | { type: 'rule' };

export interface ListItem {
  spans: InlineSpan[];
  /** Nested blocks (sub-lists, extra paragraphs). */
  children: Block[];
  /** `- [x]` task state, when present. */
  checked?: boolean;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*$/;
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const UL_ITEM = /^(\s*)[-*+]\s+(.*)$/;
const OL_ITEM = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

function pushSpan(out: InlineSpan[], text: string, styles: InlineStyle[], href?: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && !href && !last.href && sameStyles(last.styles, styles)) {
    last.text += text;
    return;
  }
  out.push({ text, styles: [...styles], ...(href ? { href } : {}) });
}

function sameStyles(a: InlineStyle[], b: InlineStyle[]): boolean {
  return a.length === b.length && a.every((s) => b.includes(s));
}

/** Parse inline markdown into styled spans. */
export function parseInline(src: string, inherited: InlineStyle[] = []): InlineSpan[] {
  const out: InlineSpan[] = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    pushSpan(out, buf, inherited);
    buf = '';
  };

  while (i < src.length) {
    const ch = src[i];

    // Escapes
    if (ch === '\\' && i + 1 < src.length && /[\\`*_~[\]()#|]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    // Inline code — highest precedence, no nested parsing.
    if (ch === '`') {
      let ticks = 0;
      while (src[i + ticks] === '`') ticks++;
      const fence = '`'.repeat(ticks);
      const end = src.indexOf(fence, i + ticks);
      if (end !== -1) {
        flush();
        pushSpan(out, src.slice(i + ticks, end).trim(), [...inherited, 'code']);
        i = end + ticks;
        continue;
      }
    }

    // Links: [text](href)  and bare autolinks <http://…>
    if (ch === '[') {
      const close = findClosing(src, i, '[', ']');
      if (close !== -1 && src[close + 1] === '(') {
        const paren = findClosing(src, close + 1, '(', ')');
        if (paren !== -1) {
          flush();
          const label = src.slice(i + 1, close);
          const href = src.slice(close + 2, paren).trim();
          for (const span of parseInline(label, [...inherited, 'link'])) {
            pushSpan(out, span.text, span.styles, href);
          }
          i = paren + 1;
          continue;
        }
      }
    }

    // Strong / emphasis / strikethrough
    let matched = false;
    for (const [marker, style] of [
      ['***', 'bold'],
      ['___', 'bold'],
      ['**', 'bold'],
      ['__', 'bold'],
      ['~~', 'strike'],
      ['*', 'italic'],
      ['_', 'italic'],
    ] as Array<[string, InlineStyle]>) {
      if (!src.startsWith(marker, i)) continue;
      // `_` only delimits at word boundaries so snake_case survives.
      if (marker.startsWith('_') && i > 0 && /\w/.test(src[i - 1])) continue;
      const end = src.indexOf(marker, i + marker.length);
      if (end === -1 || end === i + marker.length) continue;
      flush();
      const extra: InlineStyle[] = marker === '***' || marker === '___' ? ['bold', 'italic'] : [style];
      for (const span of parseInline(src.slice(i + marker.length, end), [...inherited, ...extra])) {
        pushSpan(out, span.text, span.styles, span.href);
      }
      i = end + marker.length;
      matched = true;
      break;
    }
    if (matched) continue;

    buf += ch;
    i++;
  }
  flush();
  return out;
}

function findClosing(src: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '\\') {
      i++;
      continue;
    }
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function parseAlign(line: string): Align[] {
  return splitRow(line).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  return parseBlocks(lines);
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code
    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[2][0];
      const indent = fence[1].length;
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const closing = lines[i].match(FENCE);
        if (closing && closing[2][0] === marker && !closing[3]) {
          i++;
          break;
        }
        body.push(lines[i].slice(indent));
        i++;
      }
      blocks.push({ type: 'code', lang: fence[3] || undefined, lines: body });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        spans: parseInline(heading[2]),
      });
      i++;
      continue;
    }

    // Setext heading (=== / ---) — only when the next line underlines text.
    if (i + 1 < lines.length && /^\s{0,3}(=+|-{2,})\s*$/.test(lines[i + 1]) && line.trim()) {
      blocks.push({
        type: 'heading',
        level: lines[i + 1].trim().startsWith('=') ? 1 : 2,
        spans: parseInline(line.trim()),
      });
      i += 2;
      continue;
    }

    // Table: a header row followed by a divider row.
    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const header = splitRow(line).map((c) => parseInline(c));
      const align = parseAlign(lines[i + 1]);
      const rows: InlineSpan[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const cells = splitRow(lines[i]).map((c) => parseInline(c));
        while (cells.length < header.length) cells.push([]);
        rows.push(cells.slice(0, Math.max(header.length, cells.length)));
        i++;
      }
      blocks.push({ type: 'table', header, rows, align });
      continue;
    }

    // Blockquote
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (QUOTE.test(lines[i]) || (lines[i].trim() && body.length))) {
        const m = lines[i].match(QUOTE);
        if (!m) break;
        body.push(m[1]);
        i++;
      }
      blocks.push({ type: 'quote', blocks: parseBlocks(body) });
      continue;
    }

    // Lists
    if (UL_ITEM.test(line) || OL_ITEM.test(line)) {
      const [list, consumed] = parseList(lines, i);
      blocks.push(list);
      i = consumed;
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      const l = lines[i];
      if (
        para.length > 0 &&
        (HEADING.test(l) ||
          FENCE.test(l) ||
          RULE.test(l) ||
          QUOTE.test(l) ||
          UL_ITEM.test(l) ||
          OL_ITEM.test(l) ||
          (l.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])))
      ) {
        break;
      }
      para.push(l.trim());
      i++;
    }
    // Soft line breaks are preserved (GFM "breaks"), so the model's intended
    // line structure survives rendering.
    blocks.push({ type: 'paragraph', lines: para.map((l) => parseInline(l)) });
  }

  return blocks;
}

function itemMatch(line: string): { indent: number; ordered: boolean; num: number; text: string } | null {
  const ol = line.match(OL_ITEM);
  if (ol) return { indent: ol[1].length, ordered: true, num: Number(ol[2]), text: ol[3] };
  const ul = line.match(UL_ITEM);
  if (ul) return { indent: ul[1].length, ordered: false, num: 0, text: ul[2] };
  return null;
}

function parseList(lines: string[], start: number): [Block, number] {
  const first = itemMatch(lines[start])!;
  const baseIndent = first.indent;
  const ordered = first.ordered;
  const items: ListItem[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // A blank line ends the list unless the next line continues it.
      const next = lines[i + 1];
      if (!next || !next.trim() || (itemMatch(next)?.indent ?? 0) < baseIndent) break;
      i++;
      continue;
    }
    const m = itemMatch(line);
    if (!m || m.indent < baseIndent || m.ordered !== ordered) break;
    if (m.indent > baseIndent) break; // handled as a child below

    let text = m.text;
    let checked: boolean | undefined;
    const task = text.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      checked = task[1].toLowerCase() === 'x';
      text = task[2];
    }

    // Gather continuation / nested lines belonging to this item.
    const childLines: string[] = [];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        const next = lines[i + 1];
        const nextIndent = next && next.trim() ? next.length - next.trimStart().length : -1;
        if (nextIndent <= baseIndent) break;
        childLines.push('');
        i++;
        continue;
      }
      const indent = l.length - l.trimStart().length;
      const isItem = itemMatch(l);
      if (isItem && indent <= baseIndent) break;
      if (!isItem && indent <= baseIndent) break;
      childLines.push(l.slice(baseIndent + 2 <= indent ? baseIndent + 2 : indent));
      i++;
    }

    items.push({
      spans: parseInline(text),
      children: childLines.length ? parseBlocks(childLines) : [],
      ...(checked === undefined ? {} : { checked }),
    });
  }

  return [{ type: 'list', ordered, start: ordered ? first.num : 1, items }, i];
}
