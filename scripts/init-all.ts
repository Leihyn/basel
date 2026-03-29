import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo,
  TOKEN_PROGRAM_ID, ACCOUNT_SIZE, createInitializeAccountInstruction,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const RPC = "https://api.devnet.solana.com";
const IDL_PATH = path.resolve(__dirname, "../target/idl/basel.json");
const PROGRAM_ID = new PublicKey("BQ1s2KUnoNTbK26JwNpg8L2Kh6LMnFXU45ydM7er8e6x");

const PAIRS = [
  { pair: "EUR/USD", mode: 0, rate: 1_082_450, bid: 1_082_300, ask: 1_082_600, v30: 682, v90: 714 },
  { pair: "CHF/USD", mode: 0, rate: 1_131_800, bid: 1_131_650, ask: 1_131_950, v30: 591, v90: 623 },
  { pair: "CHF/EUR", mode: 0, rate: 1_045_620, bid: 1_045_500, ask: 1_045_740, v30: 428, v90: 465 },
  { pair: "GBP/USD", mode: 0, rate: 1_294_100, bid: 1_293_950, ask: 1_294_250, v30: 745, v90: 789 },
  { pair: "XAU/USD", mode: 1, rate: 3_021_450_000, bid: 3_020_800_000, ask: 3_022_100_000, v30: 1432, v90: 1518 },
  { pair: "XAG/USD", mode: 1, rate: 33_680_000, bid: 33_620_000, ask: 33_740_000, v30: 2215, v90: 2340 },
];

const LIQUIDITY = 1_000_000_000_000; // 1M each side

async function main() {
  const keypairData = JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  const wallet = new anchor.Wallet(keypair);
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  const program = new anchor.Program(idl as any, provider);

  console.log("Program:", PROGRAM_ID.toBase58());
  console.log("Authority:", wallet.publicKey.toBase58());
  console.log("");

  // KYC — approve our wallet
  const [kycPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("kyc"), wallet.publicKey.toBuffer()], PROGRAM_ID
  );
  let kycExists = false;
  try { await (program.account as any).kycRecord.fetch(kycPda); kycExists = true; } catch {}
  if (!kycExists) {
    await program.methods.approveWallet(
      wallet.publicKey, 2,
      new anchor.BN(Math.floor(Date.now() / 1000) + 86400 * 365),
      Array.from(Buffer.alloc(32, 0xcc)),
    ).accounts({
      kycRecord: kycPda, authority: wallet.publicKey, systemProgram: SystemProgram.programId,
    }).rpc();
    console.log("KYC approved\n");
  } else {
    console.log("KYC already exists\n");
  }

  const now = Math.floor(Date.now() / 1000);

  for (const p of PAIRS) {
    console.log(`=== ${p.pair} (${p.mode === 1 ? "Cash" : "Physical"}) ===`);

    // 1. Oracle
    const [oraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle"), Buffer.from(p.pair)], PROGRAM_ID
    );
    let oracleExists = false;
    try { await (program.account as any).oracleRate.fetch(oraclePda); oracleExists = true; } catch {}

    if (!oracleExists) {
      await program.methods.initializeOracle(p.pair).accounts({
        oracle: oraclePda, authority: wallet.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();
      console.log("  oracle: initialized");
    } else {
      console.log("  oracle: exists");
    }

    // Push rate (multiple times to build TWAP)
    for (let i = 0; i < 3; i++) {
      await program.methods.updateRate(
        new anchor.BN(p.rate), new anchor.BN(p.bid), new anchor.BN(p.ask),
        new anchor.BN(now), Array.from(Buffer.alloc(32, 0xab)),
        new anchor.BN(p.v30), new anchor.BN(p.v90),
      ).accounts({ oracle: oraclePda, authority: wallet.publicKey }).rpc();
    }
    console.log("  oracle: rates pushed (3x for TWAP)");

    // 2. Vault
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from(p.pair)], PROGRAM_ID
    );
    let vaultExists = false;
    try { await (program.account as any).vault.fetch(vaultPda); vaultExists = true; } catch {}

    if (!vaultExists) {
      const baseMint = await createMint(connection, keypair, keypair.publicKey, null, 6);
      const quoteMint = await createMint(connection, keypair, keypair.publicKey, null, 6);

      const rentExempt = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);

      async function makeVaultTokenAccount(mint: PublicKey): Promise<PublicKey> {
        const kp = Keypair.generate();
        const createIx = SystemProgram.createAccount({
          fromPubkey: keypair.publicKey, newAccountPubkey: kp.publicKey,
          space: ACCOUNT_SIZE, lamports: rentExempt, programId: TOKEN_PROGRAM_ID,
        });
        const initIx = createInitializeAccountInstruction(kp.publicKey, mint, vaultPda, TOKEN_PROGRAM_ID);
        const tx = new anchor.web3.Transaction().add(createIx, initIx);
        await anchor.web3.sendAndConfirmTransaction(connection, tx, [keypair, kp]);
        return kp.publicKey;
      }

      const baseTA = await makeVaultTokenAccount(baseMint);
      const quoteTA = await makeVaultTokenAccount(quoteMint);

      await program.methods.initializeVault(p.pair, p.mode).accounts({
        vault: vaultPda, baseMint, quoteMint,
        baseTokenAccount: baseTA, quoteTokenAccount: quoteTA,
        authority: wallet.publicKey, systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      console.log("  vault: initialized");

      // Fund
      const adminBase = (await getOrCreateAssociatedTokenAccount(connection, keypair, baseMint, keypair.publicKey)).address;
      const adminQuote = (await getOrCreateAssociatedTokenAccount(connection, keypair, quoteMint, keypair.publicKey)).address;
      await mintTo(connection, keypair, baseMint, adminBase, keypair, LIQUIDITY);
      await mintTo(connection, keypair, quoteMint, adminQuote, keypair, LIQUIDITY);

      await program.methods.depositLiquidity(new anchor.BN(LIQUIDITY), 0).accounts({
        vault: vaultPda, vaultTokenAccount: baseTA,
        depositorTokenAccount: adminBase, authority: wallet.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      await program.methods.depositLiquidity(new anchor.BN(LIQUIDITY), 1).accounts({
        vault: vaultPda, vaultTokenAccount: quoteTA,
        depositorTokenAccount: adminQuote, authority: wallet.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      console.log("  vault: funded 1M each side");
    } else {
      console.log("  vault: exists (already funded)");
    }

    console.log("");
  }

  console.log("ALL DONE. Program fully initialized on devnet.");
  console.log("Program ID: " + PROGRAM_ID.toBase58());
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
