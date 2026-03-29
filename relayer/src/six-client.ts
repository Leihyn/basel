import * as https from "https";
import * as fs from "fs";
import * as crypto from "crypto";
import { config, PAIR_CONFIGS } from "./config";

export interface SixRateData {
  pair: string;
  valorBc: string;
  mid: number;
  bid: number;
  ask: number;
  timestamp: string;
  vol30d: number;
  vol90d: number;
  sourceHash: Buffer;
}

let cachedAgent: https.Agent | null = null;

function getAgent(): https.Agent {
  if (cachedAgent) return cachedAgent;

  const cert = fs.readFileSync(config.six.certPath);
  const key = fs.readFileSync(config.six.keyPath);

  cachedAgent = new https.Agent({
    cert,
    key,
    rejectUnauthorized: true,
  });

  return cachedAgent;
}

export async function fetchRates(): Promise<SixRateData[]> {
  const ids = PAIR_CONFIGS.map((p) => p.valorBc).join(",");
  const url = `${config.six.baseUrl}/web/v2/listings/marketData/intradaySnapshot?scheme=VALOR_BC&ids=${ids}&preferredLanguage=EN`;

  const rawBody = await httpGet(url);
  const sourceHash = crypto.createHash("sha256").update(rawBody).digest();
  const data = JSON.parse(rawBody);

  const results: SixRateData[] = [];

  for (const listing of data.data.listings) {
    if (listing.lookupStatus !== "FOUND") {
      console.warn(`[SIX] Lookup failed for ${listing.requestedId}: ${listing.lookupStatus}`);
      continue;
    }

    const snap = listing.marketData?.intradaySnapshot;
    if (!snap) {
      console.warn(`[SIX] No snapshot data for ${listing.requestedId}`);
      continue;
    }

    const pairConfig = PAIR_CONFIGS.find((p) => p.valorBc === listing.requestedId);
    if (!pairConfig) continue;

    results.push({
      pair: pairConfig.pair,
      valorBc: pairConfig.valorBc,
      mid: snap.mid?.value ?? 0,
      bid: snap.bestBid?.value ?? 0,
      ask: snap.bestAsk?.value ?? 0,
      timestamp: snap.mid?.timestamp ?? new Date().toISOString(),
      vol30d: snap.historicalVolatility30Days?.value ?? 0,
      vol90d: snap.historicalVolatility90Days?.value ?? 0,
      sourceHash,
    });
  }

  return results;
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent: getAgent() }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`SIX API returned ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("SIX API request timed out"));
    });
  });
}
