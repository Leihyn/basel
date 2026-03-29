"use client";

import { useState, useEffect } from "react";
import { Connection } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import { getVaultPda } from "@/lib/program";
import { RPC_URL, PAIR_CONFIGS, isMetal, METAL_NAMES } from "@/lib/constants";
import * as anchor from "@coral-xyz/anchor";

interface VaultInfo {
  pair: string;
  data: any;
  baseBalance: number;
  quoteBalance: number;
}

export default function VaultPage() {
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadVaults();
  }, []);

  async function loadVaults() {
    try {
      const conn = new Connection(RPC_URL, "confirmed");
      const res = await fetch("/idl/basel.json");
      const idl = await res.json();
      const provider = new anchor.AnchorProvider(conn, {} as any, {});
      const program = new anchor.Program(idl, provider);

      const loaded: VaultInfo[] = [];
      for (const pc of PAIR_CONFIGS) {
        try {
          const pda = getVaultPda(pc.pair);
          const data: any = await (program.account as any).vault.fetch(pda);
          let baseBalance = 0;
          let quoteBalance = 0;
          try {
            const baseAcc = await getAccount(conn, data.baseTokenAccount);
            baseBalance = Number(baseAcc.amount) / 1e6;
          } catch {}
          try {
            const quoteAcc = await getAccount(conn, data.quoteTokenAccount);
            quoteBalance = Number(quoteAcc.amount) / 1e6;
          } catch {}
          loaded.push({ pair: pc.pair, data, baseBalance, quoteBalance });
        } catch {}
      }
      setVaults(loaded);
    } catch (e) {
      console.error("Failed to load vaults:", e);
    }
    setLoading(false);
  }

  const metalVaults = vaults.filter((v) => isMetal(v.pair));
  const fxVaults = vaults.filter((v) => !isMetal(v.pair));

  function baseName(pair: string): string {
    if (isMetal(pair)) return METAL_NAMES[pair] || pair.split("/")[0];
    const base = pair.split("/")[0];
    return base === "EUR" ? "EURC" : base === "CHF" ? "CHFC" : base === "GBP" ? "GBPC" : base;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold">Vaults</h1>
        <p className="text-zinc-400 mt-1">
          Liquidity pools backing structured product settlements
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-xl p-6 animate-pulse h-48" />
          ))}
        </div>
      ) : vaults.length === 0 ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-zinc-400">No vaults initialized</p>
        </div>
      ) : (
        <div className="space-y-8">
          {metalVaults.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-amber-500 uppercase tracking-widest mb-4">
                Metals
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {metalVaults.map((v) => (
                  <VaultCard key={v.pair} vault={v} baseName={baseName(v.pair)} />
                ))}
              </div>
            </div>
          )}
          {fxVaults.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-accent uppercase tracking-widest mb-4">
                FX Pairs
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {fxVaults.map((v) => (
                  <VaultCard key={v.pair} vault={v} baseName={baseName(v.pair)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VaultCard({ vault, baseName }: { vault: VaultInfo; baseName: string }) {
  const metal = isMetal(vault.pair);
  return (
    <div className={`bg-bg-card border rounded-xl p-6 card-hover ${
      metal ? "border-amber-500/30" : "border-border"
    }`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold ${
            metal ? "bg-amber-500/15 text-amber-500" : "bg-accent/15 text-accent"
          }`}>
            {vault.pair.split("/")[0]}
          </div>
          <div>
            <p className="font-semibold text-sm">{metal ? METAL_NAMES[vault.pair] : vault.pair}</p>
            <p className="text-xs text-zinc-600 font-mono">{vault.pair}</p>
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          metal ? "bg-amber-500/10 text-amber-500" : "bg-accent/10 text-accent"
        }`}>
          {vault.data.settlementMode?.cashSettled ? "Cash" : "Physical"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-bg-secondary rounded-lg p-3">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">{baseName}</p>
          <p className="text-xl font-mono font-bold">{vault.baseBalance.toLocaleString()}</p>
        </div>
        <div className="bg-bg-secondary rounded-lg p-3">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">USDC</p>
          <p className="text-xl font-mono font-bold">{vault.quoteBalance.toLocaleString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-y-2 text-xs">
        <span className="text-zinc-600">Positions</span>
        <span className="font-mono text-right">{vault.data.nextNonce.toNumber()}</span>
        <span className="text-zinc-600">Authority</span>
        <span className="font-mono text-right text-zinc-500">{vault.data.authority.toBase58().slice(0, 12)}...</span>
      </div>
    </div>
  );
}
