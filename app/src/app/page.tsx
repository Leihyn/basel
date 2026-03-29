import Link from "next/link";

export default function Home() {
  return (
    <div className="space-y-20">
      {/* Hero */}
      <section className="text-center py-24 relative">
        <div className="relative">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-8 text-xs font-medium bg-accent/10 text-accent-light border border-accent/20 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-green live-dot" />
            Live on Solana Devnet
          </div>
          <h1 className="text-6xl font-extrabold tracking-tight mb-6 leading-[1.1]">
            Dual Currency
            <br />
            <span className="text-accent-light">Investments</span>
            <br />
            on Solana
          </h1>
          <p className="text-lg text-zinc-400 max-w-xl mx-auto mb-10 leading-relaxed">
            Programmable FX and metals vaults with structured product settlement.
            Real-time pricing by SIX Group. Every trade attested on-chain.
          </p>
          <div className="flex gap-3 justify-center">
            <Link
              href="/invest"
              className="px-6 py-3 bg-brand-white text-bg-primary font-bold rounded-lg transition-all hover:bg-accent-light"
            >
              Start Investing
            </Link>
            <Link
              href="/rates"
              className="px-6 py-3 bg-bg-card hover:bg-bg-hover border border-border rounded-lg font-semibold transition-colors"
            >
              View Live Prices
            </Link>
          </div>
        </div>
      </section>

      {/* Asset classes */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-widest mb-6 text-center">
          Supported Assets
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { symbol: "Au", name: "Gold", pair: "XAU/USD", accent: "amber" },
            { symbol: "Ag", name: "Silver", pair: "XAG/USD", accent: "amber" },
            { symbol: "EUR", name: "Euro", pair: "EUR/USD", accent: "silver" },
            { symbol: "CHF", name: "Swiss Franc", pair: "CHF/USD", accent: "silver" },
            { symbol: "GBP", name: "British Pound", pair: "GBP/USD", accent: "silver" },
            { symbol: "+", name: "More coming", pair: "XPT, XPD...", accent: "zinc" },
          ].map((asset) => (
            <div
              key={asset.pair}
              className={`bg-bg-card border border-border rounded-xl p-4 card-hover ${
                asset.accent === "zinc" ? "opacity-50" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${
                    asset.accent === "amber"
                      ? "bg-amber-500/15 text-amber-400"
                      : asset.accent === "silver"
                      ? "bg-accent/15 text-accent-light"
                      : "bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {asset.symbol}
                </div>
                <div>
                  <p className="font-semibold text-sm">{asset.name}</p>
                  <p className="text-xs text-zinc-500 font-mono">{asset.pair}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section>
        <h2 className="text-2xl font-extrabold mb-2 text-center">How It Works</h2>
        <p className="text-zinc-500 text-center mb-8">Three steps to institutional-grade structured products</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              step: "01",
              title: "Deposit",
              desc: "Deposit USDC into a KYC-gated vault. Select an asset (gold, silver, or FX pair), set your strike and tenor.",
            },
            {
              step: "02",
              title: "Earn Premium",
              desc: "Receive an upfront premium derived from SIX Group volatility data. Earned regardless of settlement outcome.",
            },
            {
              step: "03",
              title: "Settlement",
              desc: "At expiry, the SIX price determines the outcome. Every settlement is attested on-chain with a compliance hash.",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="bg-bg-card border border-border rounded-xl p-6 card-hover"
            >
              <span className="text-xs font-mono text-accent mb-3 block">
                {item.step}
              </span>
              <h3 className="font-bold mb-2 text-[15px]">{item.title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {[
          { label: "Data Source", value: "SIX Group", sub: "Swiss regulated pricing" },
          { label: "Settlement", value: "On-Chain", sub: "Immutable attestations" },
          { label: "Compliance", value: "KYC / AML", sub: "Travel Rule compliant" },
          { label: "Network", value: "Solana", sub: "Sub-second finality" },
        ].map((item) => (
          <div
            key={item.label}
            className="bg-bg-card border border-border rounded-xl px-5 py-4 text-center"
          >
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">
              {item.label}
            </p>
            <p className="font-bold">{item.value}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{item.sub}</p>
          </div>
        ))}
      </section>

      {/* Powered by badge */}
      <div className="text-center pb-8">
        <span className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold bg-accent/10 text-accent border border-accent/20 rounded-full">
          Powered by Solana
        </span>
      </div>
    </div>
  );
}
