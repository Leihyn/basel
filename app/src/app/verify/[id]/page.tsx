"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { fetchAttestation } from "@/lib/program";
import { Attestation } from "@/lib/types";
import { isMetal, formatRate, METAL_NAMES } from "@/lib/constants";

export default function VerifyPage() {
  const params = useParams();
  const positionId = params.id as string;
  const [attestation, setAttestation] = useState<Attestation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!positionId) return;
    fetchAttestation(positionId)
      .then((data) => {
        if (data) {
          setAttestation(data);
        } else {
          setError("Attestation not found for this position");
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to fetch attestation");
        setLoading(false);
      });
  }, [positionId]);

  function directionLabel(att: Attestation): string {
    const base = isMetal(att.pair) ? (METAL_NAMES[att.pair] || att.pair.split("/")[0]) : att.pair.split("/")[0];
    return att.direction === "QuoteToBase" ? `USDC -> ${base}` : `${base} -> USDC`;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Verify Attestation</h1>
        <p className="text-zinc-400 mt-1">
          Immutable settlement proof on Solana
        </p>
      </div>

      {loading ? (
        <div className="bg-bg-card border border-border rounded-xl p-6 animate-pulse h-64" />
      ) : error ? (
        <div className="bg-bg-card border border-accent-red/30 rounded-xl p-8 text-center">
          <p className="text-accent-red">{error}</p>
          <p className="text-xs text-zinc-600 mt-2 font-mono">{positionId}</p>
        </div>
      ) : attestation ? (
        <div className="space-y-4">
          {/* Verified badge */}
          <div className={`border rounded-xl p-5 ${
            isMetal(attestation.pair) ? "bg-amber-500/5 border-amber-500/30" : "bg-accent-green/5 border-accent-green/30"
          }`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                isMetal(attestation.pair) ? "bg-amber-500/15" : "bg-accent-green/15"
              }`}>
                <svg
                  className={`w-5 h-5 ${isMetal(attestation.pair) ? "text-amber-400" : "text-accent-green"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className={`font-semibold ${isMetal(attestation.pair) ? "text-amber-400" : "text-accent-green"}`}>
                  Verified on Solana
                </p>
                <p className="text-xs text-zinc-500">
                  Immutable attestation — cannot be altered
                </p>
              </div>
            </div>
          </div>

          {/* Settlement Details */}
          <div className="bg-bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold mb-4 text-sm">Settlement Details</h3>
            <div className="grid grid-cols-2 gap-y-3 text-sm">
              <span className="text-zinc-500">Pair</span>
              <span className="font-mono text-right">
                {isMetal(attestation.pair) && METAL_NAMES[attestation.pair]
                  ? `${METAL_NAMES[attestation.pair]} (${attestation.pair})`
                  : attestation.pair}
              </span>

              <span className="text-zinc-500">SIX Rate at Settlement</span>
              <span className="font-mono text-right">{formatRate(attestation.pair, attestation.sixRate)}</span>

              <span className="text-zinc-500">Amount In</span>
              <span className="font-mono text-right">{attestation.amountIn.toLocaleString()}</span>

              <span className="text-zinc-500">Amount Out</span>
              <span className="font-mono text-right">{attestation.amountOut.toLocaleString()}</span>

              <span className="text-zinc-500">Converted</span>
              <span className="text-right">
                {attestation.converted ? (
                  <span className="text-accent-amber">Yes</span>
                ) : (
                  <span className="text-accent-green">No (returned original)</span>
                )}
              </span>

              <span className="text-zinc-500">Direction</span>
              <span className="text-right">{directionLabel(attestation)}</span>

              <span className="text-zinc-500">Settlement Time</span>
              <span className="text-right text-xs">
                {new Date(attestation.createdAt * 1000).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Cryptographic Proofs */}
          <div className="bg-bg-card border border-border rounded-xl p-5">
            <h3 className="font-semibold mb-4 text-sm">Cryptographic Proofs</h3>
            <div className="space-y-3">
              {[
                { label: "Attestation PDA", value: attestation.pubkey },
                { label: "Source Hash (SIX API)", value: attestation.sourceHash },
                { label: "Compliance Hash", value: attestation.complianceHash },
                { label: "Position Owner", value: attestation.sender },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1">{item.label}</p>
                  <code className="text-xs bg-bg-secondary px-3 py-1.5 rounded-md block overflow-x-auto font-mono text-zinc-400">
                    {item.value}
                  </code>
                </div>
              ))}
            </div>
          </div>

          <a
            href={`https://explorer.solana.com/address/${attestation.pubkey}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center py-3 bg-bg-card border border-border rounded-xl text-sm text-accent hover:bg-bg-hover transition-colors"
          >
            View on Solana Explorer
          </a>
        </div>
      ) : null}
    </div>
  );
}
