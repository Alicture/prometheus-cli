import { useEffect, useState } from 'react';

export interface TerminalSize {
  columns: number;
  rows: number;
}

function read(fallback: TerminalSize): TerminalSize {
  return {
    columns: process.stdout.columns || fallback.columns,
    rows: process.stdout.rows || fallback.rows,
  };
}

/** Terminal size in columns/rows, kept in sync with resize events. */
export function useTerminalSize(fallback: TerminalSize = { columns: 80, rows: 24 }): TerminalSize {
  const [size, setSize] = useState(() => read(fallback));
  useEffect(() => {
    const onResize = () => setSize(read(fallback));
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallback.columns, fallback.rows]);
  return size;
}

/** Terminal width in columns, kept in sync with resize events. */
export function useTerminalWidth(fallback = 80): number {
  return useTerminalSize({ columns: fallback, rows: 24 }).columns;
}
