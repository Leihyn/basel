import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

export const config = {
  six: {
    baseUrl: process.env.SIX_API_BASE || "https://api.six-group.com",
    certPath:
      process.env.SIX_CERT_PATH ||
      path.resolve(__dirname, "../certs/signed-certificate.pem"),
    keyPath:
      process.env.SIX_KEY_PATH ||
      path.resolve(__dirname, "../certs/private-key.pem"),
  },
  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    keypairPath:
      (process.env.SOLANA_KEYPAIR_PATH || "~/.config/solana/id.json").replace("~", process.env.HOME || ""),
    programId: process.env.PROGRAM_ID || "BQ1s2KUnoNTbK26JwNpg8L2Kh6LMnFXU45ydM7er8e6x",
  },
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "10000"),
};

// FX + precious metals pair configs: pair name → VALOR_BC identifier
export const PAIR_CONFIGS = [
  { pair: "EUR/USD", valorBc: "946681_149" },
  { pair: "CHF/USD", valorBc: "275164_149" },
  { pair: "CHF/EUR", valorBc: "968880_149" },
  { pair: "GBP/USD", valorBc: "275017_149" },
  { pair: "XAU/USD", valorBc: "274702_148" },
  { pair: "XAG/USD", valorBc: "274720_148" },
];
