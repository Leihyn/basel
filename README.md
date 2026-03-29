# Basel

**The first Dual Currency Investment vault on Solana.**

Structured FX products are a $500 trillion market. Banks like UBS and Julius Baer sell them daily to wealth clients. The most popular instrument, the Dual Currency Investment, lets depositors earn premium by taking a view on exchange rates. Both outcomes known before you deposit.

In DeFi, this market is empty. No structured FX products. No regulated price data. No compliance proofs. Basel changes that.

**[Live Demo](https://basel-dci.vercel.app)** | **[Pitch Video](https://youtu.be/TODO)** | **[Demo Video](https://youtu.be/TODO)** | **[Program on Solana](https://solscan.io/account/BQ1s2KUnoNTbK26JwNpg8L2Kh6LMnFXU45ydM7er8e6x?cluster=devnet)**

---

## How a DCI Works

```
You deposit 998 USDC.
You pick EUR/USD, strike = 1.278, tenor = 1 hour.

The vault pays you 0.32 USDC premium upfront.
  Premium priced from SIX Group 30-day realized volatility.
  You keep it no matter what.

At expiry, the TWAP oracle determines outcome:

  EUR/USD < 1.278  →  You keep 998 USDC + 0.32 premium     ← profit
  EUR/USD ≥ 1.278  →  Deposit converts to 781 EURC          ← conversion
                       + 0.32 USDC premium

Either way: an immutable attestation records the SIX rate,
compliance hash, and settlement details on Solana.
```

**The insight:** A DCI is an option in structured product clothing.

| Basel Product | Options Equivalent | Where It Leads |
|---|---|---|
| DCI (QuoteToBase) | Short Put | Explicit puts |
| DCI (BaseToQuote) | Covered Call | Explicit calls |
| Range DCI | Short Strangle | Straddles, strangles |

Same oracle. Same vault. Same settlement engine. The infrastructure scales from DCIs to a full on-chain institutional derivatives desk.

---

## What Makes Basel Different

**Regulated data, not Chainlink.** Rates come from SIX Group, the Swiss financial infrastructure provider that runs the Swiss stock exchange. The same data UBS, AMINA Bank, and Credit Suisse use. Published to Solana every 10 seconds via mTLS-authenticated relayer with SHA-256 integrity proofs.

**Compliance is not optional.** Every DCI creation checks an on-chain KYC registry. Every settlement produces an immutable attestation with a SHA-256 compliance hash linking to off-chain AML/KYT records. Auditor-friendly. Regulator-friendly.

**Six asset pairs, two settlement modes.** Four FX pairs (EUR/USD, CHF/USD, CHF/EUR, GBP/USD) with physical settlement (actual USDC ↔ EURC swaps). Two precious metals (XAU/USD, XAG/USD) with cash settlement in USDC. Gold's 30-day vol is ~26%, so a gold DCI pays ~1.4% premium per week (~74% annualized).

**Vault LPs provide settlement liquidity and earn premiums.** Every DCI premium collected flows to the vault. Withdrawal guards prevent insolvency. The contract checks `available = balance - exposure` before any withdrawal.

**Not a prototype.** 23/23 tests passing. 12 on-chain instructions. Deployed on Solana devnet. Under $0.01 per transaction.

---

## Architecture

```
          SIX Group API (mTLS)
          Real-time FX + Metals
                  │
                  ▼
         ┌────────────────┐
         │  Basel Relayer  │  Pulls rates every 10s
         │  (Node.js)      │  SHA-256 integrity hash
         └────────┬───────┘
                  │
                  ▼
    ┌──────────────────────────────┐
    │      Solana (Devnet)         │
    │                              │
    │  Oracle PDAs ──── KYC Registry
    │  (6 pairs,       (wallet
    │   TWAP ring       approval,
    │   buffer)         expiry)
    │                              │
    │  DCI Vault ────── Attestation
    │  (physical +      PDAs
    │   cash settled,   (immutable
    │   exposure        settlement
    │   tracking)       receipts)
    │                              │
    │  Positions ────── Rolling
    │  (active/         Strategies
    │   settled/        (auto-renew
    │   transferred)    crank)
    │                              │
    └──────────────────────────────┘
                  │
                  ▼
    ┌──────────────────────────────┐
    │    Basel Frontend (Next.js)  │
    │                              │
    │  /invest    DCI creation     │
    │  /rates     Live SIX data    │
    │  /positions Portfolio view   │
    │  /vault     Liquidity mgmt   │
    │  /verify    Attestation check│
    └──────────────────────────────┘
```

---

## Features (All Implemented and Tested)

### 1. TWAP Oracle
A single price at expiry can be manipulated. Basel's oracle maintains a ring buffer of 6 observations (one every 10 seconds = 1-minute TWAP). Settlement uses the average, not spot. Much harder to game.

### 2. Vault Exposure Tracking
Tracks `total_base_exposure` and `total_quote_exposure` across all active positions. Incremented on create, decremented on settle. The withdrawal guard uses this to prevent insolvency.

### 3. Range DCI
Two strikes instead of one. Higher premium because the user takes more risk. If the rate stays between strikes, no conversion. If it breaks out, conversion occurs.

### 4. Cash Settlement (Precious Metals)
Gold and silver DCIs settle in USDC, not physical metal. `amount_out = amount * spot / strike`. Same cash settlement model banks use for commodity DCIs.

### 5. Position Transfer
DCI positions are Solana accounts. The `transfer_position` instruction changes ownership, enabling a secondary market. If the rate moves in your favor, your position has value.

### 6. Rolling Strategy
`create_rolling_strategy` saves preferences. `execute_roll` is a permissionless crank. When a position settles, anyone can trigger a new one with the same parameters. Institutional "set and forget."

### 7. Volatility-Based Premium Validation
Minimum premium check: `premium >= amount * vol_30d * tenor_factor / 7B`. Prevents the vault from giving away optionality below fair value. Uses SIX Group 30-day vol already on-chain.

### 8. Withdrawal Guard
Before any withdrawal: `available = token_balance - exposure`. If withdrawal exceeds available, it reverts with `VaultInsufficientLiquidity`. Active positions are always backed.

---

## Compliance

**KYC Registry.** On-chain registry where a compliance officer approves wallets with KYC level and expiry. `create_dci` checks this before any deposit.

**Compliance Hash.** Every position stores a SHA-256 hash of the off-chain compliance payload (KYC status, AML screening, sanctions lists, Travel Rule data). Auditors verify by recomputing.

**Settlement Attestation.** Every settlement creates an immutable on-chain record: SIX rate, amounts in/out, compliance hash, timestamp, conversion flag. Cannot be edited or deleted.

---

## Test Results

23/23 passing on Solana devnet:

```
Basel DCI Vault
  Oracle + TWAP
    ✔ initializes oracle and accepts rate updates
    ✔ computes TWAP from multiple observations
  KYC
    ✔ approves wallet with level 2
  Vault
    ✔ initializes physical settlement vault with token accounts
    ✔ accepts liquidity deposits
    ✔ creates user token accounts
  Settlement Math
    ✔ QuoteToBase: rate < strike → converts to base (physical)
    ✔ QuoteToBase: rate >= strike → returns deposit unchanged
    ✔ BaseToQuote: rate >= strike → converts to quote
    ✔ BaseToQuote: rate < strike → returns base deposit unchanged
    ✔ QuoteToBase: exactly at strike → NO conversion (strict <)
    ✔ BaseToQuote: exactly at strike → CONVERTS (>=)
    ✔ Range DCI (QuoteToBase): rate inside range → no conversion
    ✔ Range DCI (QuoteToBase): rate at lower strike → converts
    ✔ Range DCI (BaseToQuote): rate >= upper strike → converts
    ✔ uses TWAP for settlement, rate reflects average not spot
  Cash Settlement
    ✔ rejects BaseToQuote on cash-settled vault
    ✔ cash-settles QuoteToBase: returns reduced USDC instead of base tokens
  Access Control
    ✔ rejects settlement before expiry
    ✔ rejects ridiculously low premium
    ✔ tracks and decrements exposure on settlement
  Transfer & Rolling
    ✔ transfers position ownership
    ✔ creates and cancels rolling strategy

23 passing
```

---

## Roadmap

### Phase 1: Production (3-6 months)
- Mainnet deployment with Softstack security audit
- Live SIX Group oracle with multi-oracle fallback (Pyth/Switchboard)
- Fireblocks custody + Squads multi-sig for vault administration

### Phase 2: Vanilla Options (6-9 months)
- Explicit call/put options with Black-Scholes pricing
- CCTP cross-chain settlement (deposit on Ethereum, settle on Solana)
- Expanded pairs: emerging market FX, equity indices via SIX

### Phase 3: Exotic Structures (9-12 months)
- FX forwards and non-deliverable forwards (NDFs)
- Composable position tokens for DeFi integration
- Barrier options, accumulators, TARFs

Built for AMINA Bank pilot readiness.

---

## Quick Start

```bash
# Prerequisites: Rust, Solana CLI, Anchor 0.30+, Node.js 20+

# Build and deploy
anchor build --no-idl
solana config set --url devnet
solana program deploy target/deploy/basel.so

# Start the relayer (requires SIX mTLS certs)
cd relayer && npm install && npm start

# Start the frontend
cd app && npm install && npm run dev

# Run tests
npx tsx scripts/test-e2e-full.ts
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contract | Anchor 0.30.1 (Rust), 12 instructions, 6 account types |
| Oracle | SIX Group Financial Information API via mTLS, TWAP ring buffer |
| Relayer | Node.js, TypeScript, @solana/web3.js |
| Frontend | Next.js 14, TypeScript, Tailwind CSS, Solana wallet adapter |
| Data | EUR/USD, CHF/USD, CHF/EUR, GBP/USD, XAU/USD, XAG/USD |

**Program ID:** `BQ1s2KUnoNTbK26JwNpg8L2Kh6LMnFXU45ydM7er8e6x` (Solana devnet)

---

## Team

| Name | Handle | Role |
|---|---|---|
| Faruukku | [@faruukku](https://twitter.com/faruukku) | Team Lead |
| soligxbt | [@soligxbt](https://twitter.com/soligxbt) | |
| Curioswhisper | [@Curioswhisper](https://twitter.com/Curioswhisper) | |
| capitanoo23 | [@DamilolaMustapha](https://twitter.com/DamilolaMustapha) | |

---

**StableHacks 2026 | Track 4: RWA-Backed Stablecoin & Commodity Vaults**
