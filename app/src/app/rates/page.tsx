"use client";

import { useState, useEffect } from "react";
import { fetchAllOracleRates } from "@/lib/program";
import { OracleRate } from "@/lib/types";
import { isMetal, formatRate, METAL_NAMES } from "@/lib/constants";

export default function RatesPage() {
  const [rates, setRates] = useState<OracleRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  async function loadRates() {
    const data = await fetchAllOracleRates();
    setRates(data);
    setIsDemo(data.length > 0 && data[0].authority === "");
    setLastUpdate(new Date());
    setLoading(false);
  }

  useEffect(() => {
    loadRates();
    const interval = setInterval(loadRates, 10000);
    return () => clearInterval(interval);
  }, []);

  const fxRates = rates.filter((r) => !isMetal(r.pair));
  const metalRates = rates.filter((r) => isMetal(r.pair));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold">Live Rates</h1>
          <p className="text-zinc-400 mt-1">
            Real-time data from SIX Group, published to Solana
          </p>
        </div>
        {lastUpdate && (
          <div className="text-right">
            {isDemo && (
              <div className="text-xs text-amber-400 mb-1">Demo rates — relayer offline</div>
            )}
            <div className="text-xs text-zinc-500">
              Updated {lastUpdate.toLocaleTimeString()}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-bg-card border border-border rounded-xl p-6 animate-pulse h-48" />
          ))}
        </div>
      ) : (
        <>
          {fxRates.length > 0 && (
            <>
              <h2 className="text-lg font-semibold text-zinc-400">FX Rates</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {fxRates.map((rate) => <RateCard key={rate.pair} rate={rate} />)}
              </div>
            </>
          )}
          {metalRates.length > 0 && (
            <>
              <h2 className="text-lg font-semibold text-zinc-400">Precious Metals</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {metalRates.map((rate) => <RateCard key={rate.pair} rate={rate} />)}
              </div>
            </>
          )}
        </>
      )}

      <div className="bg-bg-secondary border border-border rounded-xl p-4 text-xs text-zinc-500">
        Rates sourced from SIX Group Financial Information API via mTLS.
        Published to Solana devnet every 10 seconds with TWAP computation.
        Oracle program: <code className="text-zinc-400">141Z9o7...ms15</code>
      </div>
    </div>
  );
}

function RateCard({ rate }: { rate: OracleRate }) {
  const metal = isMetal(rate.pair);
  const name = METAL_NAMES[rate.pair];
  const spread = metal
    ? `$${(rate.ask - rate.bid).toFixed(2)}`
    : `${((rate.ask - rate.bid) * 10000).toFixed(1)} pips`;

  return (
    <div className="bg-bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{name ? `${name} (${rate.pair})` : rate.pair}</h3>
        <div className="flex gap-2">
          {metal && <span className="text-xs px-2 py-1 bg-amber-500/10 text-amber-400 rounded-full">Cash Settled</span>}
          <span className="text-xs px-2 py-1 bg-accent-green/10 text-accent-green rounded-full">LIVE</span>
        </div>
      </div>
      <div className="text-3xl font-mono font-bold mb-1">{formatRate(rate.pair, rate.rate)}</div>
      {rate.twap > 0 && (
        <div className="text-sm font-mono text-zinc-400 mb-3">TWAP: {formatRate(rate.pair, rate.twap)}</div>
      )}
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div><p className="text-zinc-500 text-xs">Bid</p><p className="font-mono">{formatRate(rate.pair, rate.bid)}</p></div>
        <div><p className="text-zinc-500 text-xs">Ask</p><p className="font-mono">{formatRate(rate.pair, rate.ask)}</p></div>
        <div><p className="text-zinc-500 text-xs">Spread</p><p className="font-mono">{spread}</p></div>
      </div>
      <div className="mt-4 pt-4 border-t border-border flex justify-between text-xs text-zinc-500">
        <span>Vol 30d: {rate.vol30d.toFixed(2)}%</span>
        <span>Vol 90d: {rate.vol90d.toFixed(2)}%</span>
        <span>{new Date(rate.timestamp * 1000).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
