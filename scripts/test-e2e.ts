import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  createMint,
  createAccount,
  createAssociatedTokenAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
  ACCOUNT_SIZE,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const RPC = "https://api.devnet.solana.com";
const IDL_PATH = path.resolve(__dirname, "../target/idl/basel.json");

async function main() {
  // Setup
  const keypairData = JSON.parse(
    fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf-8")
  );
  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  const wallet = new anchor.Wallet(keypair);
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  const program = new anchor.Program(idl as any, provider);
  const programId = program.programId;

  // Use a unique test pair each run to avoid PDA collisions
  const testId = Date.now().toString().slice(-4);
  const pair = `TST${testId}`;

  console.log("=== Basel E2E Test ===");
  console.log("Program:", programId.toBase58());
  console.log("Authority:", wallet.publicKey.toBase58());
  console.log("Test pair:", pair);
  console.log("");

  // ─── 1. Oracle ───────────────────────────────────────────────────
  console.log("--- 1. Oracle ---");
  const [oraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), Buffer.from(pair)],
    programId
  );

  await program.methods
    .initializeOracle(pair)
    .accounts({
      oracle: oraclePda,
      authority: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .updateRate(
      new anchor.BN(1_155_800),
      new anchor.BN(1_155_600),
      new anchor.BN(1_156_000),
      new anchor.BN(Math.floor(Date.now() / 1000)),
      Array.from(Buffer.alloc(32, 0xab)),
      new anchor.BN(696),
      new anchor.BN(720)
    )
    .accounts({
      oracle: oraclePda,
      authority: wallet.publicKey,
    })
    .rpc();

  const oracleData: any = await program.account.oracleRate.fetch(oraclePda);
  console.log(`Oracle ${pair}: rate=${oracleData.rate.toNumber() / 1e6}, vol30d=${oracleData.vol30D.toNumber() / 100}%  [PASS]`);

  // ─── 2. KYC ──────────────────────────────────────────────────────
  console.log("\n--- 2. KYC Approve ---");
  const testUser = wallet.publicKey; // using same wallet for simplicity
  const [kycPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("kyc"), testUser.toBuffer()],
    programId
  );

  let kycExists = false;
  try {
    await program.account.kycRecord.fetch(kycPda);
    kycExists = true;
  } catch {}

  if (!kycExists) {
    const expiresAt = new anchor.BN(Math.floor(Date.now() / 1000) + 86400 * 365);
    const complianceHash = Array.from(Buffer.alloc(32, 0xcc));

    await program.methods
      .approveWallet(testUser, 2, expiresAt, complianceHash)
      .accounts({
        kycRecord: kycPda,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("KYC approved  [PASS]");
  } else {
    console.log("KYC already exists  [SKIP]");
  }

  // Verify KYC
  const kycData: any = await program.account.kycRecord.fetch(kycPda);
  console.log(`KYC: wallet=${kycData.wallet.toBase58().slice(0, 8)}... level=${kycData.kycLevel} expires=${new Date(kycData.expiresAt.toNumber() * 1000).toISOString().slice(0, 10)}`);

  // ─── 3. Create Token Mints (EURC-dev, USDC-dev) ─────────────────
  console.log("\n--- 3. Create Test Tokens ---");
  const baseMint = await createMint(connection, keypair, keypair.publicKey, null, 6);
  console.log("EURC-dev mint:", baseMint.toBase58());

  const quoteMint = await createMint(connection, keypair, keypair.publicKey, null, 6);
  console.log("USDC-dev mint:", quoteMint.toBase58());

  // ─── 4. Initialize Vault ─────────────────────────────────────────
  console.log("\n--- 4. Initialize Vault ---");
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from(pair)],
    programId
  );

  // Create token accounts owned by vault PDA (use keypair accounts since PDA is off-curve)
  const vaultBaseKeypair = Keypair.generate();
  const vaultQuoteKeypair = Keypair.generate();

  const rentExempt = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);

  // Create base token account
  const createBaseIx = SystemProgram.createAccount({
    fromPubkey: keypair.publicKey,
    newAccountPubkey: vaultBaseKeypair.publicKey,
    space: ACCOUNT_SIZE,
    lamports: rentExempt,
    programId: TOKEN_PROGRAM_ID,
  });
  const initBaseIx = (await import("@solana/spl-token")).createInitializeAccountInstruction(
    vaultBaseKeypair.publicKey, baseMint, vaultPda, TOKEN_PROGRAM_ID
  );
  const baseTx = new anchor.web3.Transaction().add(createBaseIx, initBaseIx);
  await anchor.web3.sendAndConfirmTransaction(connection, baseTx, [keypair, vaultBaseKeypair]);
  const vaultBaseAta = vaultBaseKeypair.publicKey;
  console.log("Vault base token account:", vaultBaseAta.toBase58());

  // Create quote token account
  const createQuoteIx = SystemProgram.createAccount({
    fromPubkey: keypair.publicKey,
    newAccountPubkey: vaultQuoteKeypair.publicKey,
    space: ACCOUNT_SIZE,
    lamports: rentExempt,
    programId: TOKEN_PROGRAM_ID,
  });
  const initQuoteIx = (await import("@solana/spl-token")).createInitializeAccountInstruction(
    vaultQuoteKeypair.publicKey, quoteMint, vaultPda, TOKEN_PROGRAM_ID
  );
  const quoteTx = new anchor.web3.Transaction().add(createQuoteIx, initQuoteIx);
  await anchor.web3.sendAndConfirmTransaction(connection, quoteTx, [keypair, vaultQuoteKeypair]);
  const vaultQuoteAta = vaultQuoteKeypair.publicKey;
  console.log("Vault quote token account:", vaultQuoteAta.toBase58());

  const vaultTx = await program.methods
    .initializeVault(pair, 0)
    .accounts({
      vault: vaultPda,
      baseMint: baseMint,
      quoteMint: quoteMint,
      baseTokenAccount: vaultBaseAta,
      quoteTokenAccount: vaultQuoteAta,
      authority: wallet.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log("Vault initialized:", vaultTx.slice(0, 20) + "...");

  // ─── 5. Fund Vault (deposit liquidity) ───────────────────────────
  console.log("\n--- 5. Deposit Liquidity ---");

  // Create admin token accounts and mint tokens
  const adminBaseAta = (await getOrCreateAssociatedTokenAccount(connection, keypair, baseMint, keypair.publicKey)).address;
  const adminQuoteAta = (await getOrCreateAssociatedTokenAccount(connection, keypair, quoteMint, keypair.publicKey)).address;

  // Mint 500K of each to admin
  await mintTo(connection, keypair, baseMint, adminBaseAta, keypair, 500_000_000_000); // 500K EURC
  await mintTo(connection, keypair, quoteMint, adminQuoteAta, keypair, 500_000_000_000); // 500K USDC
  console.log("Minted 500K EURC-dev + 500K USDC-dev to admin");

  // Deposit base (side=0)
  await program.methods
    .depositLiquidity(new anchor.BN(500_000_000_000), 0)
    .accounts({
      vault: vaultPda,
      vaultTokenAccount: vaultBaseAta,
      depositorTokenAccount: adminBaseAta,
      authority: wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log("Deposited 500K EURC-dev to vault");

  // Deposit quote (side=1)
  await program.methods
    .depositLiquidity(new anchor.BN(500_000_000_000), 1)
    .accounts({
      vault: vaultPda,
      vaultTokenAccount: vaultQuoteAta,
      depositorTokenAccount: adminQuoteAta,
      authority: wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log("Deposited 500K USDC-dev to vault");

  // Verify balances
  const vaultBaseBalance = await getAccount(connection, vaultBaseAta);
  const vaultQuoteBalance = await getAccount(connection, vaultQuoteAta);
  console.log(`Vault balances: EURC=${Number(vaultBaseBalance.amount) / 1e6} USDC=${Number(vaultQuoteBalance.amount) / 1e6}`);

  // ─── 6. Create DCI Position ──────────────────────────────────────
  console.log("\n--- 6. Create DCI ---");

  // Create user token accounts (using same wallet)
  const userQuoteAta = (await getOrCreateAssociatedTokenAccount(connection, keypair, quoteMint, keypair.publicKey)).address;
  const userBaseAta = (await getOrCreateAssociatedTokenAccount(connection, keypair, baseMint, keypair.publicKey)).address;

  // Mint 10K USDC to user for deposit
  await mintTo(connection, keypair, quoteMint, userQuoteAta, keypair, 10_000_000_000); // 10K USDC
  console.log("Minted 10K USDC-dev to user");

  // Update oracle with devnet-relative timestamp so it's not stale
  const freshSlot = await connection.getSlot();
  const freshBlockTime = await connection.getBlockTime(freshSlot);
  const oracleTs = freshBlockTime || Math.floor(Date.now() / 1000);
  await program.methods
    .updateRate(
      new anchor.BN(1_155_800),
      new anchor.BN(1_155_600),
      new anchor.BN(1_156_000),
      new anchor.BN(oracleTs),
      Array.from(Buffer.alloc(32, 0xab)),
      new anchor.BN(696),
      new anchor.BN(720)
    )
    .accounts({
      oracle: oraclePda,
      authority: wallet.publicKey,
    })
    .rpc();
  console.log("Oracle refreshed with devnet timestamp");

  // Create DCI: deposit 10K USDC, strike = 1.16 (above current 1.1558)
  // Direction: QuoteToBase (deposit USDC, may receive EURC if rate < strike)
  // Expiry: 30 seconds from now (for testing)
  const vaultData: any = await program.account.vault.fetch(vaultPda);
  const nonce = vaultData.nextNonce.toNumber();
  const [positionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("dci"),
      vaultPda.toBuffer(),
      wallet.publicKey.toBuffer(),
      new anchor.BN(nonce).toArrayLike(Buffer, "le", 8),
    ],
    programId
  );

  const strike = new anchor.BN(1_160_000); // 1.16
  // Use devnet clock (can be hours behind real time) + small buffer
  const slot = await connection.getSlot();
  const blockTime = await connection.getBlockTime(slot);
  const devnetNow = blockTime || Math.floor(Date.now() / 1000);
  console.log(`Devnet clock: ${devnetNow} (real: ${Math.floor(Date.now() / 1000)}, drift: ${Math.floor(Date.now() / 1000) - devnetNow}s)`);
  const expiry = new anchor.BN(devnetNow + 20); // 20s after devnet time
  const amount = new anchor.BN(10_000_000_000); // 10K USDC
  const premium = new anchor.BN(30_000_000); // 30 USDC premium (~0.3%)
  const direction = { quoteToBase: {} };

  const createTx = await program.methods
    .createDci(strike, expiry, amount, direction, premium, Array.from(Buffer.alloc(32, 0xdd)), new anchor.BN(0))
    .accounts({
      vault: vaultPda,
      oracle: oraclePda,
      kycRecord: kycPda,
      position: positionPda,
      userDepositTokenAccount: userQuoteAta,
      vaultDepositTokenAccount: vaultQuoteAta,
      vaultPremiumTokenAccount: vaultQuoteAta, // premium paid in same currency as deposit
      userPremiumTokenAccount: userQuoteAta,
      owner: wallet.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log("DCI created:", createTx.slice(0, 20) + "...");

  // Verify position
  const posData: any = await program.account.dciPosition.fetch(positionPda);
  console.log(`Position: strike=${posData.strike.toNumber() / 1e6} amount=${posData.amount.toNumber() / 1e6} USDC premium=${posData.premiumPaid.toNumber() / 1e6} USDC status=${JSON.stringify(posData.status)}`);

  // Check user got premium
  const userQuoteAfter = await getAccount(connection, userQuoteAta);
  console.log(`User USDC balance after: ${Number(userQuoteAfter.amount) / 1e6} (should have premium ~30 USDC)`);

  // ─── 7. Wait for expiry then settle ──────────────────────────────
  console.log("\n--- 7. Settle DCI ---");
  const [attestationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("attestation"), positionPda.toBuffer()],
    programId
  );

  // Retry settlement until the devnet clock catches up
  let settleTx = "";
  for (let attempt = 1; attempt <= 12; attempt++) {
    console.log(`Waiting for expiry... attempt ${attempt}/12`);
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Refresh oracle with devnet-relative timestamp
    const settleSlot = await connection.getSlot();
    const settleBlockTime = await connection.getBlockTime(settleSlot);
    await program.methods
      .updateRate(
        new anchor.BN(1_155_800),
        new anchor.BN(1_155_600),
        new anchor.BN(1_156_000),
        new anchor.BN(settleBlockTime || Math.floor(Date.now() / 1000)),
        Array.from(Buffer.alloc(32, 0xab)),
        new anchor.BN(696),
        new anchor.BN(720)
      )
      .accounts({
        oracle: oraclePda,
        authority: wallet.publicKey,
      })
      .rpc();

    try {
      settleTx = await program.methods
        .settleDci()
        .accounts({
          vault: vaultPda,
          oracle: oraclePda,
          position: positionPda,
          attestation: attestationPda,
          vaultBaseTokenAccount: vaultBaseAta,
          vaultQuoteTokenAccount: vaultQuoteAta,
          ownerBaseTokenAccount: userBaseAta,
          ownerQuoteTokenAccount: userQuoteAta,
          positionOwner: wallet.publicKey,
          cranker: wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log("DCI settled:", settleTx.slice(0, 20) + "...");
      break;
    } catch (e: any) {
      if (e.error?.errorCode?.code === "DCINotExpired") {
        continue;
      }
      throw e;
    }
  }
  if (!settleTx) throw new Error("Settlement never succeeded — devnet clock too slow");

  // Verify settlement
  const settledPos: any = await program.account.dciPosition.fetch(positionPda);
  console.log(`Settled: status=${JSON.stringify(settledPos.status)} rate=${Number(settledPos.settlementRate.toString()) / 1e6} amountOut=${Number(settledPos.settlementAmount.toString()) / 1e6}`);

  // Verify attestation
  const attData: any = await program.account.attestation.fetch(attestationPda);
  console.log(`Attestation: pair=${attData.pair} rate=${Number(attData.sixRate.toString()) / 1e6} converted=${attData.converted} amountIn=${Number(attData.amountIn.toString()) / 1e6} amountOut=${Number(attData.amountOut.toString()) / 1e6}`);

  // Final user balance
  const finalQuote = await getAccount(connection, userQuoteAta);
  console.log(`User final USDC: ${Number(finalQuote.amount) / 1e6}`);

  console.log("\n=== ALL TESTS PASSED ===");
  console.log("Program:", programId.toBase58());
  console.log("Oracle PDA:", oraclePda.toBase58());
  console.log("Vault PDA:", vaultPda.toBase58());
  console.log("Position PDA:", positionPda.toBase58());
  console.log("Attestation PDA:", attestationPda.toBase58());
}

main().catch((e) => {
  console.error("\n!!! TEST FAILED !!!");
  console.error(e);
  process.exit(1);
});
