import { useEffect, useState } from 'react';

/** Terminal width in columns, kept in sync with resize events. */
export function useTerminalWidth(fallback = 80): number {
  const [width, setWidth] = useState(process.stdout.columns || fallback);
  useEffect(() => {
    const onResize = () => setWidth(process.stdout.columns || fallback);
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, [fallback]);
  return width;
}
