# Frontend Brief

## What is Basel?

Basel publishes regulated FX rates from SIX Group (Switzerland's financial data authority) onto Solana as a public oracle. The first application: a stablecoin settlement flow that creates immutable, auditor-friendly payment attestations on-chain. Think "Stripe for institutional cross-border stablecoin payments, backed by real financial data."

## Your Scope

**You own**: Everything in `app/` — the entire Next.js frontend.

**Backend owns**: The Solana program (oracle PDAs, attestation PDAs) and the relayer service that publishes SIX rates to Solana. You'll read directly from Solana — there's no REST API between you and the chain.

**You do NOT need to**:
- Write any Solana program code
- Understand Anchor or Rust
- Touch the relayer service
- Handle actual mTLS or SIX API calls

---

## Tech Stack

| Tool | Version | Why |
|------|---------|-----|
| Next.js | 14 (App Router) | SSR + file-based routing |
| TypeScript | 5+ | Non-negotiable |
| Tailwind CSS | 3+ | Rapid styling |
| @solana/web3.js | 1.x | Read accounts, send transactions |
| @solana/wallet-adapter-react | Latest | Wallet connect (Phantom, Solflare) |
| @solana/wallet-adapter-react-ui | Latest | Pre-built wallet button |

```bash
npx create-next-app@latest app --typescript --tailwind --app --src-dir
cd app
npm install @solana/web3.js @solana/wallet-adapter-base @solana/wallet-adapter-react @solana/wallet-adapter-react-ui @solana/wallet-adapter-wallets
```

---

## Pages

### Priority Order

| Priority | Page | Day |
|----------|------|-----|
| P0 | `/pay` | Day 1 |
| P1 | `/rates` | Day 2 |
| P1 | `/treasury` | Day 2 |
| P2 | `/verify/[id]` | Day 2 |
| P2 | `/` (landing) | Day 2 |

---

### `/` — Landing Page

**Purpose**: Explain Basel in 10 seconds, get the user to connect their wallet.

**Layout**:
- Top nav: Logo (text "Basel" in a clean sans-serif), nav links, Connect Wallet button (right)
- Hero section: Headline, 1-2 sentence subtext, "Start Payment" CTA
- Three feature cards below: "Regulated Rates", "On-Chain Attestations", "Compliance Built-In"
- Footer: "Built for StableHacks 2026" + GitHub link

**Copy direction**:
- Headline: "Institutional-grade settlement on Solana"
- Subtext: "SIX Group FX rates, on-chain attestations, full compliance trail."

---

### `/pay` — Invoice Payment Flow (P0, build this first)

**Purpose**: The core demo. User selects a currency pair, enters an amount, sees the live SIX rate, and executes a payment that creates an on-chain attestation.

**Layout (single-column, centered, max-w-lg)**:

1. **Currency Pair Selector**
   - Dropdown or segmented control: `EUR/USD`, `CHF/USD`, `GBP/USD`
   - Shows the live SIX rate below the selector (e.g., "1 EUR = 1.0842 USD")
   - Small text: "Source: SIX Group | Updated 3s ago"

2. **Payment Form**
   - "Recipient" — text input (Solana address or ENS-style label)
   - "Amount" — numeric input with currency label (e.g., "1,000 EURC")
   - Auto-calculated output: "Recipient receives: 1,084.20 USDC"
   - The conversion uses the SIX rate shown above

3. **Rate Details Card** (collapsible, default closed)
   - SIX rate: 1.0842
   - Rate timestamp: 2026-03-19T14:30:00Z
   - Source hash: `0x7f3a...` (truncated, copy button)
   - Oracle account: `BasL...` (truncated, copy button)

4. **"Pay" Button**
   - Disabled until wallet connected + valid inputs
   - On click: builds transaction, signs via wallet adapter, submits
   - Loading state while confirming

5. **Success State** (replaces the form after confirmation)
   - Green checkmark
   - "Payment Attested"
   - Attestation ID (link to `/verify/[id]`)
   - Transaction signature (link to Solana Explorer)
   - Amount sent / received
   - "Make Another Payment" button

**Until backend is ready**: Use the mock data below. The "Pay" button should simulate a 2-second delay, then show the success state with mock attestation data.

---

### `/rates` — Rate Monitor Dashboard (P1)

**Purpose**: Secondary demo showing the oracle is composable. Shows all SIX rates being published on-chain in real-time.

**Layout**:
- Three rate cards in a row (or grid on mobile):
  - Each card: pair name, current rate (large text), last updated timestamp
  - Subtle pulse animation on update
- Below cards: rate history chart (last 50 updates) — use any charting lib (recharts is fine)
- Auto-refresh every 5 seconds (poll the oracle PDAs)

---

### `/treasury` — Payment History (P1)

**Purpose**: Treasury view of all attested payments for the connected wallet.

**Layout**:
- Requires wallet connection (show "Connect wallet to view treasury" if disconnected)
- Filter row: date range picker, currency pair filter
- Table columns:

| Date | Counterparty | Sent | Received | SIX Rate | Pair | Attestation | Verify |
|------|-------------|------|----------|----------|------|-------------|--------|
| Mar 19 14:30 | 7xKq...3nP | 1,000 EURC | 1,084.20 USDC | 1.0842 | EUR/USD | BasL...9x | Link icon |

- "Export CSV" button (top right) — exports the table as CSV
- Pagination (10 per page)

**Data source**: Query all attestation PDAs where `sender` or `recipient` matches the connected wallet.

---

### `/verify/[id]` — Attestation Verification (P2)

**Purpose**: Anyone can verify a payment attestation by its ID.

**Layout (centered card, max-w-md)**:
- Input field at top: "Enter Attestation ID" with "Verify" button
- If ID is in the URL param, auto-loads
- Verification card:
  - Large "Verified" badge (green) or "Not Found" (red)
  - All attestation fields displayed in a clean key-value layout:
    - Sender, Recipient, Amount In, Amount Out, Pair, SIX Rate, SIX Timestamp, Source Hash, Created At, Tx Signature
  - "View on Solana Explorer" link
  - "View Source Rate" link (to SIX if applicable)

---

## Data Types

These are the TypeScript interfaces for the on-chain data you'll be reading. Use these as your source of truth for typing.

```typescript
// Oracle rate — one per currency pair, stored in a PDA
interface OracleRate {
  pair: string;        // "EUR/USD"
  rate: number;        // 1.0842 (scaled from on-chain u64, divide by 1e6)
  timestamp: number;   // Unix seconds — when SIX published this rate
  sourceHash: string;  // SHA-256 hex of the raw SIX API response
  updatedSlot: number; // Solana slot when last updated
}

// Attestation — one per payment, stored in a PDA
interface Attestation {
  id: string;          // PDA address (base58)
  sender: string;      // Payer wallet pubkey (base58)
  recipient: string;   // Recipient wallet pubkey (base58)
  amountIn: number;    // Amount sent (e.g., 1000 EURC, scaled from u64 / 1e6)
  amountOut: number;   // Amount received (e.g., 1084.20 USDC, scaled from u64 / 1e6)
  pair: string;        // "EUR/USD"
  sixRate: number;     // 1.0842 (the SIX rate used, scaled from u64 / 1e6)
  sixTimestamp: number; // Unix seconds — SIX rate timestamp at time of payment
  sourceHash: string;  // SHA-256 hex matching the oracle's sourceHash
  complianceHash: string; // SHA-256 hex of off-chain compliance payload
  createdAt: number;   // Unix seconds — when attestation was created
  txSignature: string; // Solana transaction signature (base58)
}
```

---

## How to Read Data from Solana

You'll read directly from Solana PDAs using `@solana/web3.js`. The backend will provide the program ID and PDA seeds once deployed. Until then, use mocks.

**Oracle rates**: There's one PDA per currency pair. The relayer updates them every ~10 seconds. You read the account data using `connection.getAccountInfo(oraclePDA)` and deserialize.

**Attestations**: Each payment creates a new PDA. To list all attestations for a wallet, use `connection.getProgramAccounts(programId, { filters: [...] })` with a memcmp filter on the sender/recipient field.

**For now**: Don't worry about deserialization. Mock the data (see below) and we'll wire the real reads on Day 2.

---

## Mock Data

Use this until the Solana program is deployed. Put it in `app/src/lib/mockData.ts`.

```typescript
export const MOCK_RATES: OracleRate[] = [
  {
    pair: "EUR/USD",
    rate: 1.0842,
    timestamp: Math.floor(Date.now() / 1000) - 5,
    sourceHash: "7f3a4b2c1d9e8f0a3b5c7d2e4f6a8b0c1d3e5f7a9b2c4d6e8f0a1b3c5d7e9f0a",
    updatedSlot: 287_654_321,
  },
  {
    pair: "CHF/USD",
    rate: 1.1247,
    timestamp: Math.floor(Date.now() / 1000) - 5,
    sourceHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
    updatedSlot: 287_654_321,
  },
  {
    pair: "GBP/USD",
    rate: 1.2631,
    timestamp: Math.floor(Date.now() / 1000) - 5,
    sourceHash: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3",
    updatedSlot: 287_654_321,
  },
];

export const MOCK_ATTESTATIONS: Attestation[] = [
  {
    id: "BasL4x7Kq9mN2pR5vW8yA3cF6hJ1tU0eI9oL2nM5qR8s",
    sender: "7xKqN2pR5vW8yA3cF6hJ1tU0eI9oL2nM5qR8sTbX4wZ",
    recipient: "3nPvW8yA3cF6hJ1tU0eI9oL2nM5qR8sTbX4wZ7xKqN2p",
    amountIn: 1000,
    amountOut: 1084.20,
    pair: "EUR/USD",
    sixRate: 1.0842,
    sixTimestamp: Math.floor(Date.now() / 1000) - 3600,
    sourceHash: "7f3a4b2c1d9e8f0a3b5c7d2e4f6a8b0c1d3e5f7a9b2c4d6e8f0a1b3c5d7e9f0a",
    complianceHash: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
    createdAt: Math.floor(Date.now() / 1000) - 3600,
    txSignature: "5KtP9mN2pR5vW8yA3cF6hJ1tU0eI9oL2nM5qR8sTbX4wZ7xKqN2pR5vW8yA3cF6hJ1tU0eI9oL2nM",
  },
  {
    id: "BasL8s7Kq9mN2pR5vW8yA3cF6hJ1tU0eI9oL2nM5qR2x",
    sender: "7xKqN2pR5vW8yA3cF6hJ1tU0eI9oL2nM5qR8sTbX4wZ",
    recipient: "9fRvW8yA3cF6hJ1tU0eI9oL2nM5qR8sTbX4wZ7xKqN2p",
    amountIn: 5000,
    amountOut: 5623.50,
    pair: "CHF/USD",
    sixRate: 1.1247,
    sixTimestamp: Math.floor(Date.now() / 1000) - 7200,
    sourceHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
    complianceHash: "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5",
    createdAt: Math.floor(Date.now() / 1000) - 7200,
    txSignature: "3JnP9mN2pR5vW8yA3cF6hJ1tU0eI9oL2nM5qR8sTbX4wZ7xKqN2pR5vW8yA3cF6hJ1tU0eI9oL2nM",
  },
  {
    id: "BasL2q7Kq9mN2pR5vW8yA3cF6hJ1tU0eI9oL2nM5qR6w",
    sender: "3nPvW8yA3cF6hJ1tU0eI9oL2nM5qR8sTbX4wZ7xKqN2p",
    recipient: "7xKqN2pR5vW8yA3cF6hJ1tU0eI9oL2nM5qR8sTbX4wZ",
    amountIn: 2500,
    amountOut: 3157.75,
    pair: "GBP/USD",
    sixRate: 1.2631,
    sixTimestamp: Math.floor(Date.now() / 1000) - 1800,
    sourceHash: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3",
    complianceHash: "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6",
    createdAt: Math.floor(Date.now() / 1000) - 1800,
    txSignature: "7RqP9mN2pR5vW8yA3cF6hJ1tU0eI9oL2nM5qR8sTbX4wZ7xKqN2pR5vW8yA3cF6hJ1tU0eI9oL2nM",
  },
];
```

**Day 1 plan**: Build `/pay` entirely against this mock data. The "Pay" button simulates a delay and returns a mock attestation. On Day 2, we swap in real Solana reads.

---

## Reading from Solana (Day 2)

When we integrate, here's the pattern:

```typescript
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com");
const PROGRAM_ID = new PublicKey("PROGRAM_ID_HERE"); // backend will provide

// Read oracle rate
async function getOracleRate(pair: string): Promise<OracleRate> {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), Buffer.from(pair)],
    PROGRAM_ID
  );
  const accountInfo = await connection.getAccountInfo(pda);
  // Deserialize accountInfo.data — we'll provide the layout
  // For now, return mock data
}

// Read attestations for a wallet
async function getAttestations(wallet: PublicKey): Promise<Attestation[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 8, bytes: wallet.toBase58() } }, // sender field
    ],
  });
  // Deserialize each account — layout TBD
  // For now, return mock data
}
```

Put these in `app/src/lib/solana.ts`. Start with mock returns, replace with real deserialization on Day 2.

---

## Design Direction

**Aesthetic**: Linear meets Stripe. Clean, institutional, trustworthy. This is for treasury teams, not retail traders.

**Specifics**:
- Dark mode (dark gray/near-black background, not pure black)
- Background: `#0a0a0f` or similar
- Text: White primary (`#fafafa`), muted secondary (`#a1a1aa`)
- Accent: A single accent color — cool blue (`#3b82f6`) or teal (`#14b8a6`)
- Cards: Subtle border (`border-zinc-800`), no shadows, no gradients
- Typography: System font stack or Inter. Monospace for addresses/hashes (JetBrains Mono or similar)
- No rounded-xl corners — use rounded-md or rounded-lg max
- No gradients, no glows, no animations beyond subtle transitions
- Trust signals: "Verified by SIX Group", "On-chain attestation", Solana logo

**Anti-patterns** (do not do these):
- Gradient backgrounds or buttons
- Neon colors
- Excessive border radius
- Confetti or celebration animations
- "Web3" aesthetic (dark purple, neon green)
- Multiple accent colors

---

## Wallet Integration

Wrap the app in the Solana wallet adapter providers. Standard setup:

```typescript
// app/src/app/providers.tsx
"use client";

import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { useMemo } from "react";

import "@solana/wallet-adapter-react-ui/styles.css";

export function SolanaProviders({ children }: { children: React.ReactNode }) {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

Use this in your root layout. The `WalletMultiButton` component gives you a connect/disconnect button for free.

---

## Timeline

**Day 1** (today):
- Scaffold Next.js app with Tailwind + wallet adapter
- Build `/pay` page with mock data (this is the money shot for the demo)
- Get the design system right — colors, spacing, typography
- If time: `/rates` with mock data

**Day 2** (tomorrow):
- Backend deploys program to devnet, provides program ID and PDA seeds
- Wire `/pay` to real oracle reads and transaction submission
- Build `/treasury` and `/verify/[id]`
- Landing page last — only if everything else works
- Polish, test wallet flows, prep for demo

---

## Questions?

Ping me on Discord/Telegram. Don't block on anything — if the backend isn't ready, mock it and keep moving. The `/pay` flow with mock data is more valuable than a perfect integration that's half-built.
