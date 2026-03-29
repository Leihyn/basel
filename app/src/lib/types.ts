export interface OracleRate {
  pair: string;
  rate: number;
  bid: number;
  ask: number;
  timestamp: number;
  vol30d: number;
  vol90d: number;
  updatedSlot: number;
  authority: string;
  twap: number;
}

export interface DCIPosition {
  pubkey: string;
  owner: string;
  vault: string;
  strike: number;
  expiry: number;
  amount: number;
  direction: "BaseToQuote" | "QuoteToBase";
  premiumRate: number;
  premiumPaid: number;
  status: "Active" | "Settled";
  settlementRate: number;
  settlementAmount: number;
  complianceHash: string;
  nonce: number;
  createdAt: number;
  strikeUpper: number;
}

export interface Attestation {
  pubkey: string;
  position: string;
  sender: string;
  vault: string;
  amountIn: number;
  amountOut: number;
  pair: string;
  sixRate: number;
  sixTimestamp: number;
  sourceHash: string;
  complianceHash: string;
  converted: boolean;
  direction: "BaseToQuote" | "QuoteToBase";
  createdAt: number;
}

export interface VaultData {
  pair: string;
  baseMint: string;
  quoteMint: string;
  baseTokenAccount: string;
  quoteTokenAccount: string;
  authority: string;
  nextNonce: number;
  totalBaseExposure: number;
  totalQuoteExposure: number;
  settlementMode: "Physical" | "CashSettled";
}

export interface RollingStrategy {
  pubkey: string;
  owner: string;
  vault: string;
  direction: "BaseToQuote" | "QuoteToBase";
  strikeOffsetBps: number;
  tenorSeconds: number;
  amount: number;
  active: boolean;
  currentPosition: string;
  lastRollAt: number;
}
