import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "BQ1s2KUnoNTbK26JwNpg8L2Kh6LMnFXU45ydM7er8e6x"
);

export const RPC_URL = "https://api.devnet.solana.com";

export const PAIR_CONFIGS = [
  { pair: "EUR/USD", valorBc: "946681_149", type: "fx" as const },
  { pair: "CHF/USD", valorBc: "275164_149", type: "fx" as const },
  { pair: "CHF/EUR", valorBc: "968880_149", type: "fx" as const },
  { pair: "GBP/USD", valorBc: "275017_149", type: "fx" as const },
  { pair: "XAU/USD", valorBc: "274702_148", type: "metal" as const },
  { pair: "XAG/USD", valorBc: "274720_148", type: "metal" as const },
];

export const METAL_NAMES: Record<string, string> = {
  "XAU/USD": "Gold",
  "XAG/USD": "Silver",
};

export const TOKEN_DECIMALS = 6;

export function isMetal(pair: string): boolean {
  return pair.startsWith("X");
}

export function formatRate(pair: string, rate: number): string {
  return isMetal(pair) ? `$${rate.toFixed(2)}` : rate.toFixed(6);
}
