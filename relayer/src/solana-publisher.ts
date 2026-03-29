import * as fs from "fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { config } from "./config";
import { SixRateData } from "./six-client";
import * as path from "path";

let program: anchor.Program | null = null;
let wallet: anchor.Wallet | null = null;

function getProgram(): anchor.Program {
  if (program) return program;

  const keypairData = JSON.parse(fs.readFileSync(config.solana.keypairPath, "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  wallet = new anchor.Wallet(keypair);

  const connection = new Connection(config.solana.rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idlPath = path.resolve(__dirname, "../../target/idl/basel.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  program = new anchor.Program(idl as any, provider);
  return program;
}

function getOraclePda(pair: string): [PublicKey, number] {
  const prog = getProgram();
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), Buffer.from(pair)],
    prog.programId
  );
}

// Scale a floating-point rate to u64 × 1e6
function scaleRate(value: number): anchor.BN {
  return new anchor.BN(Math.round(value * 1_000_000));
}

// Scale volatility to u64 × 1e4 (e.g. 6.87% → 687)
function scaleVol(value: number): anchor.BN {
  return new anchor.BN(Math.round(value * 100));
}

export async function publishRate(rateData: SixRateData): Promise<string | null> {
  const prog = getProgram();
  const [oraclePda] = getOraclePda(rateData.pair);

  // Parse timestamp to unix seconds
  const unixTimestamp = new anchor.BN(
    Math.floor(new Date(rateData.timestamp).getTime() / 1000)
  );

  // Convert sourceHash Buffer to array
  const sourceHash = Array.from(rateData.sourceHash);

  try {
    const tx = await prog.methods
      .updateRate(
        scaleRate(rateData.mid),
        scaleRate(rateData.bid),
        scaleRate(rateData.ask),
        unixTimestamp,
        sourceHash,
        scaleVol(rateData.vol30d),
        scaleVol(rateData.vol90d)
      )
      .accounts({
        oracle: oraclePda,
        authority: wallet!.publicKey,
      })
      .rpc();

    return tx;
  } catch (err: any) {
    // If oracle doesn't exist yet, initialize it first
    if (err.message?.includes("AccountNotInitialized") || err.message?.includes("not found")) {
      console.log(`[Solana] Initializing oracle for ${rateData.pair}...`);
      try {
        await prog.methods
          .initializeOracle(rateData.pair)
          .accounts({
            oracle: oraclePda,
            authority: wallet!.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        // Retry the update
        const tx = await prog.methods
          .updateRate(
            scaleRate(rateData.mid),
            scaleRate(rateData.bid),
            scaleRate(rateData.ask),
            unixTimestamp,
            sourceHash,
            scaleVol(rateData.vol30d),
            scaleVol(rateData.vol90d)
          )
          .accounts({
            oracle: oraclePda,
            authority: wallet!.publicKey,
          })
          .rpc();

        return tx;
      } catch (initErr: any) {
        console.error(`[Solana] Failed to initialize oracle for ${rateData.pair}:`, initErr.message);
        return null;
      }
    }

    console.error(`[Solana] Failed to update ${rateData.pair}:`, err.message);
    return null;
  }
}
