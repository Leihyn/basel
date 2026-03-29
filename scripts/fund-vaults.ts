import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount, mintTo, getAccount, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const RPC = "https://api.devnet.solana.com";
const IDL_PATH = path.resolve(__dirname, "../target/idl/basel.json");
const PROGRAM_ID = new PublicKey("BQ1s2KUnoNTbK26JwNpg8L2Kh6LMnFXU45ydM7er8e6x");

const PAIRS = ["EUR/USD", "CHF/USD", "CHF/EUR", "GBP/USD", "XAU/USD", "XAG/USD"];
const LIQUIDITY = 1_000_000_000_000; // 1M tokens each side

async function main() {
  const keypairData = JSON.parse(
    fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf-8")
  );
  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  const wallet = new anchor.Wallet(keypair);
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  const program = new anchor.Program(idl as any, provider);

  console.log("Funding vaults with 1M tokens each side...\n");

  for (const pair of PAIRS) {
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from(pair)], PROGRAM_ID
    );

    let vaultData: any;
    try {
      vaultData = await (program.account as any).vault.fetch(vaultPda);
    } catch {
      console.log(`${pair}: no vault found, skipping`);
      continue;
    }

    const baseMint = vaultData.baseMint;
    const quoteMint = vaultData.quoteMint;
    const baseTokenAccount = vaultData.baseTokenAccount;
    const quoteTokenAccount = vaultData.quoteTokenAccount;

    const baseBalance = await getAccount(connection, baseTokenAccount).then(a => Number(a.amount)).catch(() => 0);
    const quoteBalance = await getAccount(connection, quoteTokenAccount).then(a => Number(a.amount)).catch(() => 0);

    if (baseBalance >= LIQUIDITY && quoteBalance >= LIQUIDITY) {
      console.log(`${pair}: already funded (base=${baseBalance / 1e6}, quote=${quoteBalance / 1e6})`);
      continue;
    }

    console.log(`${pair}: funding...`);

    const adminBase = (await getOrCreateAssociatedTokenAccount(connection, keypair, baseMint, keypair.publicKey)).address;
    const adminQuote = (await getOrCreateAssociatedTokenAccount(connection, keypair, quoteMint, keypair.publicKey)).address;

    if (baseBalance < LIQUIDITY) {
      const needed = LIQUIDITY - baseBalance;
      await mintTo(connection, keypair, baseMint, adminBase, keypair, needed);
      await program.methods.depositLiquidity(new anchor.BN(needed), 0).accounts({
        vault: vaultPda,
        vaultTokenAccount: baseTokenAccount,
        depositorTokenAccount: adminBase,
        authority: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      console.log(`  base: +${needed / 1e6}`);
    }

    if (quoteBalance < LIQUIDITY) {
      const needed = LIQUIDITY - quoteBalance;
      await mintTo(connection, keypair, quoteMint, adminQuote, keypair, needed);
      await program.methods.depositLiquidity(new anchor.BN(needed), 1).accounts({
        vault: vaultPda,
        vaultTokenAccount: quoteTokenAccount,
        depositorTokenAccount: adminQuote,
        authority: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      console.log(`  quote: +${needed / 1e6}`);
    }

    console.log(`  DONE\n`);
  }

  // Refresh oracle timestamps
  console.log("Refreshing oracles...\n");
  const now = Math.floor(Date.now() / 1000);
  const RATES: Record<string, [number, number, number, number, number]> = {
    "EUR/USD": [1_082_450, 1_082_300, 1_082_600, 682, 714],
    "CHF/USD": [1_131_800, 1_131_650, 1_131_950, 591, 623],
    "CHF/EUR": [1_045_620, 1_045_500, 1_045_740, 428, 465],
    "GBP/USD": [1_294_100, 1_293_950, 1_294_250, 745, 789],
    "XAU/USD": [3_021_450_000, 3_020_800_000, 3_022_100_000, 1432, 1518],
    "XAG/USD": [33_680_000, 33_620_000, 33_740_000, 2215, 2340],
  };

  for (const pair of PAIRS) {
    const [oraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle"), Buffer.from(pair)], PROGRAM_ID
    );
    const [rate, bid, ask, v30, v90] = RATES[pair];
    try {
      await program.methods.updateRate(
        new anchor.BN(rate), new anchor.BN(bid), new anchor.BN(ask),
        new anchor.BN(now), Array.from(Buffer.alloc(32, 0xab)),
        new anchor.BN(v30), new anchor.BN(v90),
      ).accounts({ oracle: oraclePda, authority: wallet.publicKey }).rpc();
      console.log(`${pair}: oracle updated`);
    } catch (e: any) {
      console.log(`${pair}: oracle failed — ${e.message?.slice(0, 80)}`);
    }
  }

  console.log("\nDone. All vaults funded, oracles refreshed.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
