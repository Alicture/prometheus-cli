import stringWidth from 'string-width';
import type { UIItem } from './types.js';
import { previewLines, summarizeToolInput } from './format.js';

// Ink can only erase and redraw a dynamic region that fits on screen. Once the
// non-<Static> output grows taller than the terminal, the previous frame can no
// longer be cleared: old frames pile up and the prompt scrolls out of view.
//
// While a turn is streaming, the whole assistant message lives in that dynamic
// region, so long answers used to push the input line off screen. We therefore
// render only the tail of the live region that fits, and let the complete
// message land in <Static> (i.e. real scrollback) when the turn finishes.

/** Number of terminal rows a wrapped block of text occupies. */
export function wrappedHeight(text: string, columns: number): number {
  if (columns <= 0) return text.split('\n').length;
  let rows = 0;
  for (const line of text.split('\n')) {
    const w = stringWidth(line);
    rows += w === 0 ? 1 : Math.ceil(w / columns);
  }
  return rows;
}

/** Rows a rendered UIItem occupies, including its top margin. */
export function itemHeight(item: UIItem, columns: number): number {
  const margin = 1;
  switch (item.kind) {
    case 'user':
      return margin + wrappedHeight(`› ${item.text}`, columns);
    case 'assistant':
      // Streaming text renders plain (see MessageItem `plain`), so height is
      // exact; the extra row covers the gap before the next item.
      return margin + wrappedHeight(item.text, columns) + 1;
    case 'notice':
      return margin + wrappedHeight(item.text, columns);
    case 'tool': {
      const head = wrappedHeight(`● ${item.name} ${summarizeToolInput(item.name, item.input)}`, columns);
      const body =
        item.status !== 'running' && item.content
          ? wrappedHeight(previewLines(item.content), Math.max(1, columns - 2))
          : 0;
      return margin + head + body;
    }
    default:
      return margin + 1;
  }
}

/** Drop all but the last `rows` display rows of `text`. */
function tailLines(text: string, columns: number, rows: number): { text: string; truncated: boolean } {
  const lines = text.split('\n');
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const h = Math.max(1, wrappedHeight(lines[i], columns));
    if (used + h > rows && kept.length > 0) return { text: kept.join('\n'), truncated: true };
    kept.unshift(lines[i]);
    used += h;
    if (used >= rows) return { text: kept.join('\n'), truncated: i > 0 };
  }
  return { text: kept.join('\n'), truncated: false };
}

export interface ClampedLive {
  items: UIItem[];
  /** True when earlier live output was hidden to keep the prompt on screen. */
  truncated: boolean;
}

/**
 * Keep the newest live items that fit in `budget` rows. The oldest visible item
 * is trimmed to its tail so streaming output stays anchored to the bottom.
 */
export function clampLiveItems(items: UIItem[], columns: number, budget: number): ClampedLive {
  if (budget <= 0) return { items: [], truncated: items.length > 0 };

  const out: UIItem[] = [];
  let used = 0;

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const h = itemHeight(item, columns);
    if (used + h <= budget) {
      out.unshift(item);
      used += h;
      continue;
    }

    const remaining = budget - used;
    // Show the tail of a long assistant/tool message rather than dropping it.
    // Reserve 2 rows for the item's top margin and trailing gap.
    if (remaining >= 3 && (item.kind === 'assistant' || item.kind === 'notice')) {
      const { text } = tailLines(item.text, columns, Math.max(1, remaining - 2));
      if (text.trim()) out.unshift({ ...item, text });
    }
    return { items: out, truncated: true };
  }

  return { items: out, truncated: false };
}
