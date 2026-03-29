/**
 * Calculate DCI premium using simplified Black-Scholes approximation.
 * Premium = notional x annualized_vol x sqrt(tenor/365) x scaling_factor
 */
export function calculatePremium(
  notional: number,
  vol30d: number,
  tenorDays: number
): number {
  const annualizedVol = vol30d / 100;
  const timeComponent = Math.sqrt(tenorDays / 365);
  const scalingFactor = 0.4;
  return notional * annualizedVol * timeComponent * scalingFactor;
}

/**
 * Calculate premium as a percentage of notional
 */
export function calculatePremiumPercent(
  vol30d: number,
  tenorDays: number
): number {
  return calculatePremium(100, vol30d, tenorDays);
}

/**
 * Calculate annualized APY from a single-period premium percentage
 */
export function calculateAnnualizedAPY(
  premiumPct: number,
  tenorDays: number
): number {
  if (tenorDays <= 0 || premiumPct <= 0) return 0;
  const periodsPerYear = 365 / tenorDays;
  return (Math.pow(1 + premiumPct / 100, periodsPerYear) - 1) * 100;
}

/**
 * Calculate minimum premium (mirrors on-chain check)
 * On-chain: premium >= amount * vol_30d / 10_000_000
 */
export function calculateMinPremium(
  vol30d: number,
  amount: number
): number {
  // vol30d is percentage (e.g. 6.96), on-chain it's × 1e4 (696)
  const volScaled = vol30d * 100; // to match on-chain 1e4 scaling
  return (amount * volScaled) / 10_000_000;
}
