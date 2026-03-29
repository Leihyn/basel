"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { fetchUserPositions, settleFromUI } from "@/lib/program";
import { DCIPosition } from "@/lib/types";
import * as anchor from "@coral-xyz/anchor";
import Link from "next/link";

function getDepositCurrency(pos: DCIPosition): string {
  const pair = pos.vault; // We'll use direction as proxy since vault is a pubkey
  if (pos.direction === "QuoteToBase") return "USDC";
  return "Base";
}

function getDirectionLabel(pos: DCIPosition): string {
  return pos.direction === "QuoteToBase" ? "USDC -> Base" : "Base -> USDC";
}

export default function PositionsPage() {
  const { connected, publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const [positions, setPositions] = useState<DCIPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [settleResult, setSettleResult] = useState<Record<string, { tx?: string; error?: string }>>({});

  useEffect(() => {
    if (!publicKey) {
      setLoading(false);
      return;
    }
    fetchUserPositions(publicKey).then((data) => {
      setPositions(data);
      setLoading(false);
    });
  }, [publicKey]);

  const handleSettle = useCallback(async (pos: DCIPosition) => {
    if (!anchorWallet) return;
    setSettlingId(pos.pubkey);

    try {
      const tx = await settleFromUI(anchorWallet as anchor.Wallet, pos);

      setSettleResult((prev) => ({ ...prev, [pos.pubkey]: { tx } }));

      if (publicKey) {
        const data = await fetchUserPositions(publicKey);
        setPositions(data);
      }
    } catch (e: any) {
      setSettleResult((prev) => ({ ...prev, [pos.pubkey]: { error: e.message || "Settlement failed" } }));
    }
    setSettlingId(null);
  }, [anchorWallet, publicKey]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold">Your Positions</h1>
        <p className="text-zinc-400 mt-1">
          Active and settled structured product positions
        </p>
      </div>

      {!connected ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-zinc-500">Connect your wallet to view positions</p>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-xl p-6 animate-pulse h-32" />
          ))}
        </div>
      ) : positions.length === 0 ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-zinc-500 mb-4">No positions yet</p>
          <Link
            href="/invest"
            className="px-5 py-2.5 bg-accent text-white rounded-lg text-sm font-semibold"
          >
            Create your first DCI
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {positions.map((pos) => {
            const isActive = pos.status === "Active";
            const now = Date.now() / 1000;
            const expired = now > pos.expiry;
            const depositCurrency = getDepositCurrency(pos);
            const result = settleResult[pos.pubkey];

            return (
              <div
                key={pos.pubkey}
                className="bg-bg-card border border-border rounded-xl p-5 card-hover"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        isActive
                          ? expired
                            ? "bg-accent-amber/10 text-accent-amber"
                            : "bg-accent/10 text-accent"
                          : "bg-accent-green/10 text-accent-green"
                      }`}
                    >
                      {isActive ? (expired ? "Expired" : "Active") : "Settled"}
                    </span>
                    <span className="font-mono text-xs text-zinc-600">
                      {pos.pubkey.slice(0, 8)}...{pos.pubkey.slice(-4)}
                    </span>
                  </div>
                  {!isActive && (
                    <Link
                      href={`/verify/${pos.pubkey}`}
                      className="text-xs text-accent hover:underline"
                    >
                      View Attestation
                    </Link>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                  <div>
                    <p className="text-zinc-600 text-[10px] uppercase tracking-wider">Deposit</p>
                    <p className="font-mono">
                      {pos.amount.toLocaleString()} {depositCurrency}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-600 text-[10px] uppercase tracking-wider">Strike</p>
                    <p className="font-mono">{pos.strike > 100 ? `$${pos.strike.toFixed(2)}` : pos.strike.toFixed(6)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-600 text-[10px] uppercase tracking-wider">Premium</p>
                    <p className="font-mono text-accent-green">
                      +{pos.premiumPaid.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-600 text-[10px] uppercase tracking-wider">Expiry</p>
                    <p className="text-xs">
                      {new Date(pos.expiry * 1000).toLocaleDateString()}{" "}
                      {new Date(pos.expiry * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-600 text-[10px] uppercase tracking-wider">Direction</p>
                    <p className="text-xs">{getDirectionLabel(pos)}</p>
                  </div>
                </div>

                {!isActive && (
                  <div className="mt-3 pt-3 border-t border-border grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-zinc-600 text-[10px] uppercase tracking-wider">Settlement Rate</p>
                      <p className="font-mono">{pos.settlementRate > 100 ? `$${pos.settlementRate.toFixed(2)}` : pos.settlementRate.toFixed(6)}</p>
                    </div>
                    <div>
                      <p className="text-zinc-600 text-[10px] uppercase tracking-wider">Returned</p>
                      <p className="font-mono">{pos.settlementAmount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-zinc-600 text-[10px] uppercase tracking-wider">Converted</p>
                      <p>{pos.settlementRate !== 0 ? "Yes" : "No"}</p>
                    </div>
                  </div>
                )}

                {isActive && expired && (
                  <div className="mt-3 space-y-2">
                    {result?.tx && (
                      <div className="bg-accent-green/10 border border-accent-green/20 rounded-lg p-2 text-sm">
                        <span className="text-accent-green font-medium">Settled </span>
                        <a
                          href={`https://explorer.solana.com/tx/${result.tx}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent hover:underline font-mono"
                        >
                          {result.tx.slice(0, 20)}...
                        </a>
                      </div>
                    )}
                    {result?.error && (
                      <div className="bg-accent-red/10 border border-accent-red/20 rounded-lg p-2 text-sm text-accent-red">
                        {result.error}
                      </div>
                    )}
                    <button
                      onClick={() => handleSettle(pos)}
                      disabled={settlingId === pos.pubkey}
                      className="w-full py-2 bg-accent-amber/10 text-accent-amber border border-accent-amber/20 rounded-lg text-sm font-medium hover:bg-accent-amber/20 transition-colors disabled:opacity-50"
                    >
                      {settlingId === pos.pubkey ? "Settling..." : "Settle Position"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
