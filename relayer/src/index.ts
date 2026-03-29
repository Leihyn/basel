import { config, PAIR_CONFIGS } from "./config";
import { fetchRates, SixRateData } from "./six-client";
import { publishRate } from "./solana-publisher";

interface HealthStatus {
  lastSuccessfulFetch: Date | null;
  lastSuccessfulPublish: Map<string, Date>;
  consecutiveErrors: number;
  totalUpdates: number;
}

const health: HealthStatus = {
  lastSuccessfulFetch: null,
  lastSuccessfulPublish: new Map(),
  consecutiveErrors: 0,
  totalUpdates: 0,
};

function logRates(rates: SixRateData[]) {
  console.log("\n┌──────────────────────────────────────────────────────────────┐");
  console.log("│  SIX Group FX Rates                                        │");
  console.log("├──────────┬────────────┬────────────┬────────────┬──────────┤");
  console.log("│ Pair     │ Mid        │ Bid        │ Ask        │ Vol 30d  │");
  console.log("├──────────┼────────────┼────────────┼────────────┼──────────┤");
  for (const r of rates) {
    const pair = r.pair.padEnd(8);
    const mid = r.mid.toFixed(6).padStart(10);
    const bid = r.bid.toFixed(6).padStart(10);
    const ask = r.ask.toFixed(6).padStart(10);
    const vol = `${r.vol30d.toFixed(2)}%`.padStart(8);
    console.log(`│ ${pair} │ ${mid} │ ${bid} │ ${ask} │ ${vol} │`);
  }
  console.log("└──────────┴────────────┴────────────┴────────────┴──────────┘");
}

async function poll() {
  const startTime = Date.now();

  try {
    // Fetch rates from SIX
    const rates = await fetchRates();
    health.lastSuccessfulFetch = new Date();
    health.consecutiveErrors = 0;

    if (rates.length === 0) {
      console.warn("[Poll] No rates returned from SIX");
      return;
    }

    logRates(rates);

    // Publish each rate to Solana
    for (const rate of rates) {
      const tx = await publishRate(rate);
      if (tx) {
        health.lastSuccessfulPublish.set(rate.pair, new Date());
        health.totalUpdates++;
        console.log(`[Solana] ${rate.pair} updated: tx=${tx.slice(0, 16)}...`);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Poll] Complete in ${elapsed}ms. Total updates: ${health.totalUpdates}`);
  } catch (err: any) {
    health.consecutiveErrors++;
    console.error(`[Poll] Error (attempt ${health.consecutiveErrors}):`, err.message);

    if (health.consecutiveErrors >= 10) {
      console.error("[Poll] Too many consecutive errors, exiting...");
      process.exit(1);
    }
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  Basel Relayer — SIX Group Oracle Publisher");
  console.log("═══════════════════════════════════════════════");
  console.log(`  RPC:      ${config.solana.rpcUrl}`);
  console.log(`  Program:  ${config.solana.programId}`);
  console.log(`  Pairs:    ${PAIR_CONFIGS.map((p) => p.pair).join(", ")}`);
  console.log(`  Interval: ${config.pollIntervalMs}ms`);
  console.log("═══════════════════════════════════════════════\n");

  // Initial poll
  await poll();

  // Start polling loop
  setInterval(poll, config.pollIntervalMs);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
