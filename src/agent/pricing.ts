import type { Tier } from '../config/index.js';

// Approximate USD pricing per 1M tokens. Used for the cost estimate in the
// status bar. Falls back to the Athena (mid) tier for unknown models.
const RATES: Record<Tier, { input: number; output: number }> = {
  hermes: { input: 0.8, output: 4 }, // haiku-class
  athena: { input: 3, output: 15 }, // sonnet-class
  zeus: { input: 15, output: 75 }, // opus-class
};

export function estimateCostUSD(tier: Tier, inputTokens: number, outputTokens: number): number {
  const rate = RATES[tier] ?? RATES.athena;
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}
