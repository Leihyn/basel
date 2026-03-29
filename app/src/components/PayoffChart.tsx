"use client";

interface PayoffChartProps {
  spot: number;
  strike: number;
  strikeUpper?: number;
  premium: number;
  amount: number;
  direction: "QuoteToBase" | "BaseToQuote";
  isMetal?: boolean;
}

export default function PayoffChart({
  spot,
  strike,
  strikeUpper,
  premium,
  amount,
  direction,
  isMetal,
}: PayoffChartProps) {
  if (!spot || !strike || !amount) return null;

  const W = 500;
  const H = 200;
  const PAD = 40;

  // X range: spot ± 15%
  const xMin = spot * 0.85;
  const xMax = spot * 1.15;
  const steps = 100;

  // Calculate payoff at each rate point
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const rate = xMin + (xMax - xMin) * (i / steps);
    let payoff: number;

    const isRange = strikeUpper && strikeUpper > 0;

    if (direction === "QuoteToBase") {
      // User deposited USDC
      const shouldConvert = isRange
        ? rate <= strike
        : rate < strike;

      if (shouldConvert) {
        // Converted: loss = amount - (amount * rate / strike)
        payoff = (amount * rate) / strike + premium - amount;
      } else {
        // No conversion: keep deposit + premium
        payoff = premium;
      }
    } else {
      // BaseToQuote: user deposited base
      const shouldConvert = isRange
        ? rate >= (strikeUpper || strike)
        : rate >= strike;

      if (shouldConvert) {
        // Converted at strike rate
        payoff = (amount * strike) / 1_000_000 + premium - amount;
      } else {
        payoff = premium;
      }
    }

    points.push({ x: rate, y: payoff });
  }

  // Y range
  const yMin = Math.min(...points.map((p) => p.y), -premium);
  const yMax = Math.max(...points.map((p) => p.y), premium * 2);
  const yRange = yMax - yMin || 1;

  // Scale to SVG coords
  const scaleX = (x: number) => PAD + ((x - xMin) / (xMax - xMin)) * (W - PAD * 2);
  const scaleY = (y: number) => H - PAD - ((y - yMin) / yRange) * (H - PAD * 2);

  // Build path
  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.x).toFixed(1)} ${scaleY(p.y).toFixed(1)}`)
    .join(" ");

  // Zero line
  const zeroY = scaleY(0);
  const spotX = scaleX(spot);
  const strikeX = scaleX(strike);
  const strikeUpperX = strikeUpper ? scaleX(strikeUpper) : null;

  const formatX = (val: number) => (isMetal ? `$${val.toFixed(0)}` : val.toFixed(4));

  return (
    <div className="bg-bg-secondary border border-border rounded-lg p-4">
      <p className="text-xs text-zinc-500 mb-2">Payoff at Expiry</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Grid */}
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#27272a" strokeWidth="1" />

        {/* Green zone (profit area above zero) */}
        {points.map((p, i) => {
          if (i === 0) return null;
          const prev = points[i - 1];
          if (p.y <= 0 && prev.y <= 0) return null;
          return (
            <rect
              key={i}
              x={scaleX(prev.x)}
              y={Math.min(scaleY(Math.max(p.y, 0)), zeroY)}
              width={(W - PAD * 2) / steps}
              height={Math.abs(scaleY(Math.max(p.y, 0)) - zeroY)}
              fill="rgba(34, 197, 94, 0.1)"
            />
          );
        })}

        {/* Red zone (loss area below zero) */}
        {points.map((p, i) => {
          if (i === 0) return null;
          if (p.y >= 0) return null;
          return (
            <rect
              key={`r${i}`}
              x={scaleX(points[i - 1].x)}
              y={zeroY}
              width={(W - PAD * 2) / steps}
              height={Math.abs(scaleY(p.y) - zeroY)}
              fill="rgba(239, 68, 68, 0.1)"
            />
          );
        })}

        {/* Payoff line */}
        <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="2" />

        {/* Strike line */}
        <line x1={strikeX} y1={PAD} x2={strikeX} y2={H - PAD} stroke="#f59e0b" strokeWidth="1" strokeDasharray="4,4" />
        <text x={strikeX} y={PAD - 5} fill="#f59e0b" fontSize="9" textAnchor="middle">
          Strike {formatX(strike)}
        </text>

        {/* Upper strike for range */}
        {strikeUpperX && (
          <>
            <line x1={strikeUpperX} y1={PAD} x2={strikeUpperX} y2={H - PAD} stroke="#f59e0b" strokeWidth="1" strokeDasharray="4,4" />
            <text x={strikeUpperX} y={PAD - 5} fill="#f59e0b" fontSize="9" textAnchor="middle">
              Upper {formatX(strikeUpper!)}
            </text>
          </>
        )}

        {/* Spot line */}
        <line x1={spotX} y1={PAD} x2={spotX} y2={H - PAD} stroke="#71717a" strokeWidth="1" strokeDasharray="2,2" />
        <text x={spotX} y={H - PAD + 15} fill="#71717a" fontSize="9" textAnchor="middle">
          Spot {formatX(spot)}
        </text>

        {/* Premium line */}
        <line x1={PAD} y1={scaleY(premium)} x2={W - PAD} y2={scaleY(premium)} stroke="#22c55e" strokeWidth="1" strokeDasharray="2,4" opacity="0.5" />

        {/* Y axis labels */}
        <text x={PAD - 5} y={scaleY(premium)} fill="#22c55e" fontSize="8" textAnchor="end" dominantBaseline="middle">
          +{premium.toFixed(0)}
        </text>
        <text x={PAD - 5} y={zeroY} fill="#71717a" fontSize="8" textAnchor="end" dominantBaseline="middle">
          0
        </text>
      </svg>
      <div className="flex justify-between text-xs text-zinc-500 mt-1">
        <span>Green = profit (keep deposit + premium)</span>
        <span>Red = conversion loss</span>
      </div>
    </div>
  );
}
