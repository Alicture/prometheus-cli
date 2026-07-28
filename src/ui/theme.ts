// Centralized colors for the Ink UI (Prometheus brand: warm amber/orange).
export const theme = {
  accent: '#E8943A', // amber
  accentBright: '#FFB35C', // lighter amber highlight
  accentDim: '#A8662A',
  user: '#7AA2F7',
  assistant: '#C0CAF5',
  tool: '#9ECE6A',
  toolError: '#F7768E',
  muted: '#565F89',
  notice: '#BB9AF7',
  bg: '#1A1B26',
} as const;

export const TIER_BADGE: Record<string, string> = {
  hermes: 'Hermes',
  athena: 'Athena',
  zeus: 'Zeus',
};
