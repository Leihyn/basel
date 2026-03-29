import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const RPC = "https://api.devnet.solana.com";
const IDL_PATH = path.resolve(__dirname, "../target/idl/basel.json");
const PROGRAM_ID = new PublicKey("BQ1s2KUnoNTbK26JwNpg8L2Kh6LMnFXU45ydM7er8e6x");
const USER = new PublicKey("32pS9WbMF1wvQs3HUXtNFnp7X89UQeCPDiq2ViN5gEZa");

const PAIRS = ["EUR/USD", "CHF/USD", "CHF/EUR", "GBP/USD", "XAU/USD", "XAG/USD"];
const AMOUNT = 100_000_000_000; // 100K tokens

async function main() {
  const keypairData = JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  const wallet = new anchor.Wallet(keypair);
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  const program = new anchor.Program(idl as any, provider);

  console.log("Minting 100K of each token to", USER.toBase58(), "\n");

  for (const pair of PAIRS) {
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from(pair)], PROGRAM_ID
    );

    let vaultData: any;
    try {
      vaultData = await (program.account as any).vault.fetch(vaultPda);
    } catch {
      console.log(`${pair}: no vault, skipping`);
      continue;
    }

    const baseMint = vaultData.baseMint;
    const quoteMint = vaultData.quoteMint;

    // Create ATAs for user and mint tokens
    const userBase = await getOrCreateAssociatedTokenAccount(connection, keypair, baseMint, USER);
    await mintTo(connection, keypair, baseMint, userBase.address, keypair, AMOUNT);
    console.log(`${pair}: base  → ${userBase.address.toBase58().slice(0, 12)}... (100K)`);

    const userQuote = await getOrCreateAssociatedTokenAccount(connection, keypair, quoteMint, USER);
    await mintTo(connection, keypair, quoteMint, userQuote.address, keypair, AMOUNT);
    console.log(`${pair}: quote → ${userQuote.address.toBase58().slice(0, 12)}... (100K)`);
    console.log("");
  }

  console.log("Done. Your wallet has 100K of each token for all 6 pairs.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
