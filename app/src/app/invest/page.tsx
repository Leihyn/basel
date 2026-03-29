"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { fetchAllOracleRates, createDCI, getVaultPda } from "@/lib/program";
import { calculatePremium, calculateAnnualizedAPY, calculateMinPremium } from "@/lib/premium";
import { OracleRate } from "@/lib/types";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { RPC_URL, isMetal, formatRate, METAL_NAMES } from "@/lib/constants";
import * as anchor from "@coral-xyz/anchor";
import PayoffChart from "@/components/PayoffChart";

const TENOR_OPTIONS = [
  { label: "1 Hour", days: 1 / 24 },
  { label: "1 Day", days: 1 },
  { label: "7 Days", days: 7 },
  { label: "14 Days", days: 14 },
  { label: "30 Days", days: 30 },
];

export default function InvestPage() {
  const { connected, publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [rates, setRates] = useState<OracleRate[]>([]);
  const [selectedPair, setSelectedPair] = useState("EUR/USD");
  const [direction, setDirection] = useState<"QuoteToBase" | "BaseToQuote">("QuoteToBase");
  const [amount, setAmount] = useState("");
  const [strikeOffset, setStrikeOffset] = useState(2);
  const [tenorIdx, setTenorIdx] = useState(2);
  const [rangeMode, setRangeMode] = useState(false);
  const [rangeWidth, setRangeWidth] = useState(4);
  const [submitting, setSubmitting] = useState(false);
  const [txResult, setTxResult] = useState<{ tx?: string; error?: string } | null>(null);

  useEffect(() => {
    fetchAllOracleRates().then(setRates);
    const interval = setInterval(() => fetchAllOracleRates().then(setRates), 10000);
    return () => clearInterval(interval);
  }, []);

  const currentRate = rates.find((r) => r.pair === selectedPair);
  const spot = currentRate?.rate ?? 0;
  const metal = isMetal(selectedPair);
  const metalName = METAL_NAMES[selectedPair];
  const strike = direction === "QuoteToBase" ? spot * (1 + strikeOffset / 100) : spot * (1 - strikeOffset / 100);
  const strikeUpper = rangeMode ? strike * (1 + rangeWidth / 100) : 0;
  const tenor = TENOR_OPTIONS[tenorIdx];
  const vol = currentRate?.vol30d ?? 0;
  const premiumMultiplier = rangeMode ? 1.5 : 1;
  const premium = amount && spot ? calculatePremium(parseFloat(amount), vol, tenor.days) * premiumMultiplier : 0;
  const premiumPct = amount ? (premium / parseFloat(amount)) * 100 : 0;
  const apy = calculateAnnualizedAPY(premiumPct, tenor.days);
  const minPremium = amount ? calculateMinPremium(vol, parseFloat(amount)) : 0;
  const depositCurrency = direction === "QuoteToBase" ? "USDC" : (metalName || "EURC");
  const convertCurrency = direction === "QuoteToBase" ? (metalName || "EURC") : "USDC";

  const handleCreateDCI = useCallback(async () => {
    if (!anchorWallet || !amount || !publicKey) return;
    setSubmitting(true);
    setTxResult(null);
    try {
      const conn = new Connection(RPC_URL, "confirmed");
      const vaultPda = getVaultPda(selectedPair);
      const res = await fetch("/idl/basel.json");
      const idl = await res.json();
      const provider = new anchor.AnchorProvider(conn, anchorWallet as any, {});
      const program = new anchor.Program(idl, provider);
      const vaultData: any = await (program.account as any).vault.fetch(vaultPda);
      const complianceHash = Array.from(Buffer.alloc(32, 0xdd));
      const expiryTimestamp = Math.floor(Date.now() / 1000) + Math.round(tenor.days * 86400);

      // Resolve user's ATAs for the vault's base and quote mints
      const userBaseAta = getAssociatedTokenAddressSync(vaultData.baseMint, publicKey, true);
      const userQuoteAta = getAssociatedTokenAddressSync(vaultData.quoteMint, publicKey, true);

      const tx = await createDCI(anchorWallet as anchor.Wallet, {
        pair: selectedPair, strike, expiryTimestamp, amount: parseFloat(amount), direction, premium, complianceHash, strikeUpper,
        userDepositTokenAccount: direction === "QuoteToBase" ? userQuoteAta : userBaseAta,
        vaultDepositTokenAccount: direction === "QuoteToBase" ? vaultData.quoteTokenAccount : vaultData.baseTokenAccount,
        vaultPremiumTokenAccount: direction === "QuoteToBase" ? vaultData.quoteTokenAccount : vaultData.baseTokenAccount,
        userPremiumTokenAccount: direction === "QuoteToBase" ? userQuoteAta : userBaseAta,
      });
      setTxResult({ tx });
    } catch (e: any) {
      setTxResult({ error: e.message || "Transaction failed" });
    }
    setSubmitting(false);
  }, [anchorWallet, publicKey, amount, selectedPair, direction, tenorIdx, strikeOffset, rangeMode, rangeWidth]);

  const fxRates = rates.filter((r) => !isMetal(r.pair));
  const metalRates = rates.filter((r) => isMetal(r.pair));

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Create DCI Position</h1>
        <p className="text-zinc-400 mt-1">Earn premium on your deposit with FX or precious metals exposure</p>
      </div>

      {!connected ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-zinc-400 mb-4">Connect your wallet to start investing</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pair Selection */}
          <div className="bg-bg-card border border-border rounded-xl p-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-3">Asset</h3>
            {fxRates.length > 0 && (
              <><p className="text-xs text-zinc-500 mb-2">FX Pairs</p>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {fxRates.map((r) => (
                  <button key={r.pair} onClick={() => setSelectedPair(r.pair)}
                    className={`p-3 rounded-lg border text-sm font-medium transition-colors ${selectedPair === r.pair ? "border-accent bg-accent/10 text-accent-light" : "border-border bg-bg-secondary hover:border-border-hover"}`}>
                    <div>{r.pair}</div><div className="text-xs font-mono mt-1 opacity-60">{r.rate.toFixed(4)}</div>
                  </button>
                ))}
              </div></>
            )}
            {metalRates.length > 0 && (
              <><p className="text-xs text-zinc-500 mb-2">Precious Metals</p>
              <div className="grid grid-cols-2 gap-2">
                {metalRates.map((r) => (
                  <button key={r.pair} onClick={() => setSelectedPair(r.pair)}
                    className={`p-3 rounded-lg border text-sm font-medium transition-colors ${selectedPair === r.pair ? "border-amber-500 bg-amber-500/10 text-amber-400" : "border-border bg-bg-secondary hover:border-border-hover"}`}>
                    <div>{METAL_NAMES[r.pair] || r.pair}</div><div className="text-xs font-mono mt-1 opacity-60">${r.rate.toFixed(2)}/oz</div>
                  </button>
                ))}
              </div></>
            )}
          </div>

          {/* Direction */}
          <div className="bg-bg-card border border-border rounded-xl p-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-3">Direction</h3>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setDirection("QuoteToBase")}
                className={`p-4 rounded-lg border text-left transition-colors ${direction === "QuoteToBase" ? "border-accent-blue bg-accent/10" : "border-border hover:border-border-hover"}`}>
                <div className="font-medium">Deposit USDC</div>
                <div className="text-xs text-zinc-400 mt-1">May convert to {metalName || "EURC"} if rate falls below strike</div>
              </button>
              <button onClick={() => setDirection("BaseToQuote")}
                className={`p-4 rounded-lg border text-left transition-colors ${direction === "BaseToQuote" ? "border-accent-blue bg-accent/10" : "border-border hover:border-border-hover"} ${metal ? "opacity-50 cursor-not-allowed" : ""}`}
                disabled={metal}>
                <div className="font-medium">Deposit {metalName || "EURC"}</div>
                <div className="text-xs text-zinc-400 mt-1">{metal ? "Not available for cash-settled assets" : "May convert to USDC if rate rises above strike"}</div>
              </button>
            </div>
          </div>

          {/* Amount + Strike + Tenor + Range */}
          <div className="bg-bg-card border border-border rounded-xl p-6 space-y-6">
            <div>
              <h3 className="text-sm font-medium text-zinc-400 mb-2">Amount ({depositCurrency})</h3>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10,000"
                className="w-full bg-bg-secondary border border-border rounded-lg px-4 py-3 font-mono text-lg focus:outline-none focus:border-accent" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-zinc-400">Strike ({strikeOffset}% from spot)</span>
                <span className="font-mono">{formatRate(selectedPair, strike)}</span>
              </div>
              <input type="range" min={0.5} max={10} step={0.5} value={strikeOffset} onChange={(e) => setStrikeOffset(parseFloat(e.target.value))} className="w-full accent-accent" />
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
                <span>0.5%</span><span>Spot: {formatRate(selectedPair, spot)}</span><span>10%</span>
              </div>
            </div>

            {/* Range Mode */}
            <div className="flex items-center justify-between">
              <div><span className="text-sm text-zinc-400">Range Mode</span><p className="text-xs text-zinc-500">Two strikes — earn higher premium</p></div>
              <button onClick={() => setRangeMode(!rangeMode)}
                className={`w-12 h-6 rounded-full transition-colors relative ${rangeMode ? "bg-accent" : "bg-zinc-700"}`}>
                <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${rangeMode ? "translate-x-6" : "translate-x-0.5"}`} />
              </button>
            </div>
            {rangeMode && (
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-zinc-400">Range Width ({rangeWidth}%)</span>
                  <span className="font-mono text-xs">{formatRate(selectedPair, strike)} — {formatRate(selectedPair, strikeUpper)}</span>
                </div>
                <input type="range" min={1} max={10} step={0.5} value={rangeWidth} onChange={(e) => setRangeWidth(parseFloat(e.target.value))} className="w-full accent-accent" />
              </div>
            )}

            <div>
              <h3 className="text-sm font-medium text-zinc-400 mb-2">Tenor</h3>
              <div className="flex gap-2">
                {TENOR_OPTIONS.map((t, i) => (
                  <button key={t.label} onClick={() => setTenorIdx(i)}
                    className={`flex-1 py-2 rounded-lg border text-sm transition-colors ${tenorIdx === i ? "border-accent bg-accent/10 text-accent-light" : "border-border hover:border-border-hover"}`}>{t.label}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Review + Payoff */}
          {amount && parseFloat(amount) > 0 && (
            <>
              <PayoffChart spot={spot} strike={strike} strikeUpper={rangeMode ? strikeUpper : undefined}
                premium={premium} amount={parseFloat(amount)} direction={direction} isMetal={metal} />

              <div className="bg-bg-card border border-accent/30 rounded-xl p-6 space-y-4">
                <h3 className="font-semibold">Review</h3>
                <div className="grid grid-cols-2 gap-y-3 text-sm">
                  <span className="text-zinc-400">Deposit</span>
                  <span className="text-right font-mono">{parseFloat(amount).toLocaleString()} {depositCurrency}</span>
                  <span className="text-zinc-400">Strike</span>
                  <span className="text-right font-mono">{formatRate(selectedPair, strike)}</span>
                  {rangeMode && (<><span className="text-zinc-400">Upper Strike</span><span className="text-right font-mono">{formatRate(selectedPair, strikeUpper)}</span></>)}
                  <span className="text-zinc-400">Tenor</span>
                  <span className="text-right">{tenor.label}</span>
                  <span className="text-zinc-400">SIX Vol (30d)</span>
                  <span className="text-right">{vol.toFixed(2)}%</span>
                  <span className="text-zinc-400">Estimated Premium</span>
                  <span className="text-right font-mono text-accent-green">+{premium.toFixed(2)} {depositCurrency} ({premiumPct.toFixed(2)}%)</span>
                  <span className="text-zinc-400">Annualized APY</span>
                  <span className="text-right font-mono text-accent-green font-bold">{apy.toFixed(1)}%</span>
                  <span className="text-zinc-400">Min Premium (vol-implied)</span>
                  <span className="text-right font-mono text-xs text-zinc-500">{minPremium.toFixed(2)} {depositCurrency}</span>
                </div>

                {txResult?.tx && (
                  <div className="p-3 bg-accent-green/10 border border-accent-green/20 rounded-lg">
                    <p className="text-sm text-accent-green font-medium">Position created!</p>
                    <a href={`https://explorer.solana.com/tx/${txResult.tx}?cluster=devnet`} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-accent-blue hover:underline font-mono">{txResult.tx.slice(0, 32)}...</a>
                  </div>
                )}
                {txResult?.error && (
                  <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded-lg text-sm text-accent-red">{txResult.error}</div>
                )}

                <button onClick={handleCreateDCI} disabled={submitting}
                  className="w-full py-3 bg-brand-white text-bg-primary hover:bg-accent-light disabled:opacity-50 rounded-lg font-medium transition-colors mt-4">
                  {submitting ? "Creating..." : rangeMode ? "Create Range DCI" : "Create DCI Position"}
                </button>
                <p className="text-xs text-zinc-500 text-center">Settlement via TWAP oracle. Priced by SIX Group. Compliance hash included.</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
