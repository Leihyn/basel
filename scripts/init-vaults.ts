import * as anchor from "@coral-xyz/anchor";
import {
  Connection, Keypair, PublicKey, SystemProgram,
} from "@solana/web3.js";
import {
  createMint, TOKEN_PROGRAM_ID, ACCOUNT_SIZE,
  createInitializeAccountInstruction,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const RPC = "https://api.devnet.solana.com";
const IDL_PATH = path.resolve(__dirname, "../target/idl/basel.json");

// settlement_mode: 0 = Physical, 1 = CashSettled
const VAULTS_TO_INIT = [
  { pair: "CHF/USD", mode: 0 },
  { pair: "CHF/EUR", mode: 0 },
  { pair: "GBP/USD", mode: 0 },
  { pair: "XAU/USD", mode: 1 },
  { pair: "XAG/USD", mode: 1 },
];

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
  const programId = program.programId;

  console.log("Authority:", wallet.publicKey.toBase58());
  console.log("");

  for (const v of VAULTS_TO_INIT) {
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from(v.pair)], programId
    );

    // Check if already exists
    const existing = await connection.getAccountInfo(vaultPda);
    if (existing) {
      console.log(`${v.pair}: vault already exists, skipping`);
      continue;
    }

    console.log(`${v.pair}: initializing (${v.mode === 1 ? "CashSettled" : "Physical"})...`);

    // Create mints
    const baseMint = await createMint(connection, keypair, keypair.publicKey, null, 6);
    const quoteMint = await createMint(connection, keypair, keypair.publicKey, null, 6);
    console.log(`  base mint: ${baseMint.toBase58()}`);
    console.log(`  quote mint: ${quoteMint.toBase58()}`);

    // Create vault token accounts
    const rentExempt = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);

    async function createVaultTokenAccount(mint: PublicKey): Promise<PublicKey> {
      const kp = Keypair.generate();
      const createIx = SystemProgram.createAccount({
        fromPubkey: keypair.publicKey,
        newAccountPubkey: kp.publicKey,
        space: ACCOUNT_SIZE,
        lamports: rentExempt,
        programId: TOKEN_PROGRAM_ID,
      });
      const initIx = createInitializeAccountInstruction(kp.publicKey, mint, vaultPda, TOKEN_PROGRAM_ID);
      const tx = new anchor.web3.Transaction().add(createIx, initIx);
      await anchor.web3.sendAndConfirmTransaction(connection, tx, [keypair, kp]);
      return kp.publicKey;
    }

    const baseTokenAccount = await createVaultTokenAccount(baseMint);
    const quoteTokenAccount = await createVaultTokenAccount(quoteMint);

    // Initialize vault
    await program.methods.initializeVault(v.pair, v.mode).accounts({
      vault: vaultPda,
      baseMint,
      quoteMint,
      baseTokenAccount,
      quoteTokenAccount,
      authority: wallet.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();

    console.log(`  vault PDA: ${vaultPda.toBase58()}`);
    console.log(`  DONE`);
    console.log("");
  }

  console.log("All vaults initialized.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
