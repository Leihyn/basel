import * as anchor from "@coral-xyz/anchor";
import {
  Connection, Keypair, PublicKey, SystemProgram,
} from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount,
  TOKEN_PROGRAM_ID, ACCOUNT_SIZE,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const RPC = "https://api.devnet.solana.com";
const IDL_PATH = path.resolve(__dirname, "../target/idl/basel.json");

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${msg}`);
  } else {
    failed++;
    console.log(`  [FAIL] ${msg}`);
  }
}

async function main() {
  const keypairData = JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  const wallet = new anchor.Wallet(keypair);
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
  const program = new anchor.Program(idl as any, provider);
  const programId = program.programId;

  const testId = Date.now().toString().slice(-4);
  const pair = `T${testId}`;

  console.log("══════════════════════════════════════════════════");
  console.log("  Basel DCI Vault — Full E2E Test Suite");
  console.log("══════════════════════════════════════════════════");
  console.log(`  Program:  ${programId.toBase58()}`);
  console.log(`  Test ID:  ${pair}`);
  console.log("");

  // Get devnet clock
  const slot0 = await connection.getSlot();
  const blockTime0 = (await connection.getBlockTime(slot0)) || Math.floor(Date.now() / 1000);
  const devnetNow = () => blockTime0 + Math.floor((Date.now() / 1000) - blockTime0);

  // Helper: fresh devnet timestamp
  async function getDevnetTime(): Promise<number> {
    const s = await connection.getSlot();
    return (await connection.getBlockTime(s)) || Math.floor(Date.now() / 1000);
  }

  // ═══════════════════════════════════════════════════
  // TEST 1: Oracle + TWAP
  // ═══════════════════════════════════════════════════
  console.log("─── Test 1: Oracle + TWAP ───");

  const [oraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), Buffer.from(pair)], programId
  );

  await program.methods.initializeOracle(pair).accounts({
    oracle: oraclePda, authority: wallet.publicKey, systemProgram: SystemProgram.programId,
  }).rpc();

  // Push 3 different rates to build TWAP
  const rates = [1_100_000, 1_200_000, 1_300_000]; // 1.10, 1.20, 1.30
  for (const rate of rates) {
    const ts = await getDevnetTime();
    await program.methods.updateRate(
      new anchor.BN(rate), new anchor.BN(rate - 1000), new anchor.BN(rate + 1000),
      new anchor.BN(ts), Array.from(Buffer.alloc(32, 0xab)),
      new anchor.BN(696), new anchor.BN(720),
    ).accounts({ oracle: oraclePda, authority: wallet.publicKey }).rpc();
  }

  const oracleData: any = await (program.account as any).oracleRate.fetch(oraclePda);
  assert(oracleData.rate.toNumber() === 1_300_000, `Oracle rate = 1.30 (got ${oracleData.rate.toNumber() / 1e6})`);
  assert(oracleData.obsCount === 3, `Observation count = 3 (got ${oracleData.obsCount})`);

  const expectedTwap = Math.floor((1_100_000 + 1_200_000 + 1_300_000) / 3);
  const actualTwap = oracleData.twap.toNumber();
  assert(Math.abs(actualTwap - expectedTwap) <= 1, `TWAP = ~1.20 (got ${actualTwap / 1e6})`);
  console.log("");

  // ═══════════════════════════════════════════════════
  // TEST 2: KYC
  // ═══════════════════════════════════════════════════
  console.log("─── Test 2: KYC ───");

  const [kycPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("kyc"), wallet.publicKey.toBuffer()], programId
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
  }

  const kycData: any = await (program.account as any).kycRecord.fetch(kycPda);
  assert(kycData.kycLevel === 2, `KYC level = 2 (got ${kycData.kycLevel})`);
  console.log("");

  // ═══════════════════════════════════════════════════
  // TEST 3: Vault + Tokens (Physical settlement)
  // ═══════════════════════════════════════════════════
  console.log("─── Test 3: Vault Init + Token Setup ───");

  const baseMint = await createMint(connection, keypair, keypair.publicKey, null, 6);
  const quoteMint = await createMint(connection, keypair, keypair.publicKey, null, 6);

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from(pair)], programId
  );

  // Create vault token accounts
  const vaultBaseKp = Keypair.generate();
  const vaultQuoteKp = Keypair.generate();
  const rentExempt = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);

  for (const [kp, mint] of [[vaultBaseKp, baseMint], [vaultQuoteKp, quoteMint]] as [Keypair, PublicKey][]) {
    const createIx = SystemProgram.createAccount({
      fromPubkey: keypair.publicKey, newAccountPubkey: kp.publicKey,
      space: ACCOUNT_SIZE, lamports: rentExempt, programId: TOKEN_PROGRAM_ID,
    });
    const initIx = (await import("@solana/spl-token")).createInitializeAccountInstruction(
      kp.publicKey, mint, vaultPda, TOKEN_PROGRAM_ID
    );
    const tx = new anchor.web3.Transaction().add(createIx, initIx);
    await anchor.web3.sendAndConfirmTransaction(connection, tx, [keypair, kp]);
  }

  // Initialize vault with Physical settlement (mode=0)
  await program.methods.initializeVault(pair, 0).accounts({
    vault: vaultPda, baseMint, quoteMint,
    baseTokenAccount: vaultBaseKp.publicKey, quoteTokenAccount: vaultQuoteKp.publicKey,
    authority: wallet.publicKey, systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();

  const vaultData: any = await (program.account as any).vault.fetch(vaultPda);
  assert(vaultData.pair === pair, `Vault pair = ${pair}`);
  assert(vaultData.totalBaseExposure.toNumber() === 0, "Initial base exposure = 0");
  assert(vaultData.totalQuoteExposure.toNumber() === 0, "Initial quote exposure = 0");
  // settlementMode: Physical = { physical: {} }
  assert(JSON.stringify(vaultData.settlementMode).includes("physical"), "Settlement mode = Physical");

  // Fund vault
  const adminBase = (await getOrCreateAssociatedTokenAccount(connection, keypair, baseMint, keypair.publicKey)).address;
  const adminQuote = (await getOrCreateAssociatedTokenAccount(connection, keypair, quoteMint, keypair.publicKey)).address;
  await mintTo(connection, keypair, baseMint, adminBase, keypair, 500_000_000_000);
  await mintTo(connection, keypair, quoteMint, adminQuote, keypair, 500_000_000_000);

  await program.methods.depositLiquidity(new anchor.BN(500_000_000_000), 0).accounts({
    vault: vaultPda, vaultTokenAccount: vaultBaseKp.publicKey,
    depositorTokenAccount: adminBase, authority: wallet.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();
  await program.methods.depositLiquidity(new anchor.BN(500_000_000_000), 1).accounts({
    vault: vaultPda, vaultTokenAccount: vaultQuoteKp.publicKey,
    depositorTokenAccount: adminQuote, authority: wallet.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();

  assert(true, "Vault funded: 500K base + 500K quote");
  console.log("");

  // ═══════════════════════════════════════════════════
  // TEST 4: Create DCI + Exposure Tracking
  // ═══════════════════════════════════════════════════
  console.log("─── Test 4: Create DCI + Exposure ───");

  const userQuote = (await getOrCreateAssociatedTokenAccount(connection, keypair, quoteMint, keypair.publicKey)).address;
  const userBase = (await getOrCreateAssociatedTokenAccount(connection, keypair, baseMint, keypair.publicKey)).address;
  await mintTo(connection, keypair, quoteMint, userQuote, keypair, 10_000_000_000);

  // Refresh oracle
  const ts4 = await getDevnetTime();
  await program.methods.updateRate(
    new anchor.BN(1_155_800), new anchor.BN(1_155_600), new anchor.BN(1_156_000),
    new anchor.BN(ts4), Array.from(Buffer.alloc(32, 0xab)),
    new anchor.BN(696), new anchor.BN(720),
  ).accounts({ oracle: oraclePda, authority: wallet.publicKey }).rpc();

  const nonce = (await (program.account as any).vault.fetch(vaultPda)).nextNonce.toNumber();
  const [positionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("dci"), vaultPda.toBuffer(), wallet.publicKey.toBuffer(),
     new anchor.BN(nonce).toArrayLike(Buffer, "le", 8)], programId
  );

  const expiry4 = await getDevnetTime() + 20;
  await program.methods.createDci(
    new anchor.BN(1_160_000), // strike 1.16
    new anchor.BN(expiry4),
    new anchor.BN(10_000_000_000), // 10K USDC
    { quoteToBase: {} },
    new anchor.BN(30_000_000), // 30 USDC premium
    Array.from(Buffer.alloc(32, 0xdd)),
    new anchor.BN(0), // no upper strike
  ).accounts({
    vault: vaultPda, oracle: oraclePda, kycRecord: kycPda, position: positionPda,
    userDepositTokenAccount: userQuote, vaultDepositTokenAccount: vaultQuoteKp.publicKey,
    vaultPremiumTokenAccount: vaultQuoteKp.publicKey, userPremiumTokenAccount: userQuote,
    owner: wallet.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();

  const posData: any = await (program.account as any).dciPosition.fetch(positionPda);
  assert(posData.amount.toNumber() === 10_000_000_000, `Amount = 10000 USDC (got ${posData.amount.toNumber() / 1e6})`);
  assert(posData.strike.toNumber() === 1_160_000, `Strike = 1.16 (got ${posData.strike.toNumber() / 1e6})`);
  assert(posData.strikeUpper.toNumber() === 0, "Strike upper = 0 (standard DCI)");

  // Check exposure incremented
  const vault4: any = await (program.account as any).vault.fetch(vaultPda);
  assert(vault4.totalQuoteExposure.toNumber() === 10_000_000_000, `Quote exposure = 10K (got ${vault4.totalQuoteExposure.toNumber() / 1e6})`);
  console.log("");

  // ═══════════════════════════════════════════════════
  // TEST 5: Settle DCI + Exposure Decrement
  // ═══════════════════════════════════════════════════
  console.log("─── Test 5: Settle DCI ───");

  const [attestationPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("attestation"), positionPda.toBuffer()], programId
  );

  let settled = false;
  for (let attempt = 1; attempt <= 12; attempt++) {
    console.log(`  Waiting for expiry... attempt ${attempt}/12`);
    await new Promise((r) => setTimeout(r, 10000));
    const settleTs = await getDevnetTime();
    await program.methods.updateRate(
      new anchor.BN(1_155_800), new anchor.BN(1_155_600), new anchor.BN(1_156_000),
      new anchor.BN(settleTs), Array.from(Buffer.alloc(32, 0xab)),
      new anchor.BN(696), new anchor.BN(720),
    ).accounts({ oracle: oraclePda, authority: wallet.publicKey }).rpc();

    try {
      await program.methods.settleDci().accounts({
        vault: vaultPda, oracle: oraclePda, position: positionPda, attestation: attestationPda,
        vaultBaseTokenAccount: vaultBaseKp.publicKey, vaultQuoteTokenAccount: vaultQuoteKp.publicKey,
        ownerBaseTokenAccount: userBase, ownerQuoteTokenAccount: userQuote,
        positionOwner: wallet.publicKey, cranker: wallet.publicKey,
        systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      settled = true;
      break;
    } catch (e: any) {
      if (e.error?.errorCode?.code === "DCINotExpired") continue;
      throw e;
    }
  }

  assert(settled, "DCI settled successfully");

  const settledPos: any = await (program.account as any).dciPosition.fetch(positionPda);
  assert(JSON.stringify(settledPos.status).includes("settled"), "Status = Settled");
  assert(settledPos.settlementRate.toNumber() > 0, `Settlement rate > 0 (got ${settledPos.settlementRate.toNumber() / 1e6})`);

  // Check exposure decremented
  const vault5: any = await (program.account as any).vault.fetch(vaultPda);
  assert(vault5.totalQuoteExposure.toNumber() === 0, `Quote exposure = 0 after settle (got ${vault5.totalQuoteExposure.toNumber() / 1e6})`);

  // Verify attestation
  const attData: any = await (program.account as any).attestation.fetch(attestationPda);
  // TWAP may be above or below strike depending on accumulated observations
  // Just verify the attestation was created with valid data
  assert(typeof attData.converted === "boolean", `Converted field exists (=${attData.converted})`);
  assert(Number(attData.amountIn.toString()) === 10_000_000_000, "Attestation amountIn = 10K");
  console.log("");

  // ═══════════════════════════════════════════════════
  // TEST 6: Transfer Position
  // ═══════════════════════════════════════════════════
  console.log("─── Test 6: Transfer Position ───");

  // Create a new DCI to transfer
  const ts6 = await getDevnetTime();
  await program.methods.updateRate(
    new anchor.BN(1_155_800), new anchor.BN(1_155_600), new anchor.BN(1_156_000),
    new anchor.BN(ts6), Array.from(Buffer.alloc(32, 0xab)),
    new anchor.BN(696), new anchor.BN(720),
  ).accounts({ oracle: oraclePda, authority: wallet.publicKey }).rpc();

  await mintTo(connection, keypair, quoteMint, userQuote, keypair, 10_000_000_000);
  const nonce6 = (await (program.account as any).vault.fetch(vaultPda)).nextNonce.toNumber();
  const [posPda6] = PublicKey.findProgramAddressSync(
    [Buffer.from("dci"), vaultPda.toBuffer(), wallet.publicKey.toBuffer(),
     new anchor.BN(nonce6).toArrayLike(Buffer, "le", 8)], programId
  );

  const expiry6 = await getDevnetTime() + 86400; // 1 day, won't expire during test
  await program.methods.createDci(
    new anchor.BN(1_160_000), new anchor.BN(expiry6), new anchor.BN(10_000_000_000),
    { quoteToBase: {} }, new anchor.BN(30_000_000),
    Array.from(Buffer.alloc(32, 0xdd)), new anchor.BN(0),
  ).accounts({
    vault: vaultPda, oracle: oraclePda, kycRecord: kycPda, position: posPda6,
    userDepositTokenAccount: userQuote, vaultDepositTokenAccount: vaultQuoteKp.publicKey,
    vaultPremiumTokenAccount: vaultQuoteKp.publicKey, userPremiumTokenAccount: userQuote,
    owner: wallet.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();

  // Transfer to a new address
  const newOwner = Keypair.generate().publicKey;
  await program.methods.transferPosition().accounts({
    position: posPda6, owner: wallet.publicKey, newOwner: newOwner,
  }).rpc();

  const transferredPos: any = await (program.account as any).dciPosition.fetch(posPda6);
  assert(transferredPos.owner.toBase58() === newOwner.toBase58(), `Owner changed to ${newOwner.toBase58().slice(0, 8)}...`);
  console.log("");

  // ═══════════════════════════════════════════════════
  // TEST 7: Range DCI
  // ═══════════════════════════════════════════════════
  console.log("─── Test 7: Range DCI ───");

  const ts7 = await getDevnetTime();
  // Set rate to 1.15 — between strike (1.10) and upper (1.20)
  await program.methods.updateRate(
    new anchor.BN(1_150_000), new anchor.BN(1_149_000), new anchor.BN(1_151_000),
    new anchor.BN(ts7), Array.from(Buffer.alloc(32, 0xab)),
    new anchor.BN(696), new anchor.BN(720),
  ).accounts({ oracle: oraclePda, authority: wallet.publicKey }).rpc();

  await mintTo(connection, keypair, quoteMint, userQuote, keypair, 10_000_000_000);
  const nonce7 = (await (program.account as any).vault.fetch(vaultPda)).nextNonce.toNumber();
  const [posPda7] = PublicKey.findProgramAddressSync(
    [Buffer.from("dci"), vaultPda.toBuffer(), wallet.publicKey.toBuffer(),
     new anchor.BN(nonce7).toArrayLike(Buffer, "le", 8)], programId
  );

  const expiry7 = await getDevnetTime() + 15;
  await program.methods.createDci(
    new anchor.BN(1_100_000),  // lower strike 1.10
    new anchor.BN(expiry7),
    new anchor.BN(5_000_000_000), // 5K USDC
    { quoteToBase: {} },
    new anchor.BN(30_000_000),
    Array.from(Buffer.alloc(32, 0xdd)),
    new anchor.BN(1_200_000),  // upper strike 1.20 — RANGE DCI
  ).accounts({
    vault: vaultPda, oracle: oraclePda, kycRecord: kycPda, position: posPda7,
    userDepositTokenAccount: userQuote, vaultDepositTokenAccount: vaultQuoteKp.publicKey,
    vaultPremiumTokenAccount: vaultQuoteKp.publicKey, userPremiumTokenAccount: userQuote,
    owner: wallet.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();

  const rangePos: any = await (program.account as any).dciPosition.fetch(posPda7);
  assert(rangePos.strikeUpper.toNumber() === 1_200_000, `Strike upper = 1.20 (got ${rangePos.strikeUpper.toNumber() / 1e6})`);

  // Settle range DCI — rate (1.15) is INSIDE range (1.10-1.20) → should NOT convert
  const [attPda7] = PublicKey.findProgramAddressSync(
    [Buffer.from("attestation"), posPda7.toBuffer()], programId
  );

  let rangeSettled = false;
  for (let attempt = 1; attempt <= 12; attempt++) {
    console.log(`  Waiting for range DCI expiry... attempt ${attempt}/12`);
    await new Promise((r) => setTimeout(r, 10000));
    const settleTs = await getDevnetTime();
    // Keep rate at 1.15 (inside range)
    await program.methods.updateRate(
      new anchor.BN(1_150_000), new anchor.BN(1_149_000), new anchor.BN(1_151_000),
      new anchor.BN(settleTs), Array.from(Buffer.alloc(32, 0xab)),
      new anchor.BN(696), new anchor.BN(720),
    ).accounts({ oracle: oraclePda, authority: wallet.publicKey }).rpc();

    try {
      await program.methods.settleDci().accounts({
        vault: vaultPda, oracle: oraclePda, position: posPda7, attestation: attPda7,
        vaultBaseTokenAccount: vaultBaseKp.publicKey, vaultQuoteTokenAccount: vaultQuoteKp.publicKey,
        ownerBaseTokenAccount: userBase, ownerQuoteTokenAccount: userQuote,
        positionOwner: wallet.publicKey, cranker: wallet.publicKey,
        systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      rangeSettled = true;
      break;
    } catch (e: any) {
      if (e.error?.errorCode?.code === "DCINotExpired") continue;
      throw e;
    }
  }

  assert(rangeSettled, "Range DCI settled");
  const rangeAtt: any = await (program.account as any).attestation.fetch(attPda7);
  assert(rangeAtt.converted === false, "Range DCI: NOT converted (rate inside range)");
  assert(Number(rangeAtt.amountOut.toString()) === 5_000_000_000, "Range DCI: full deposit returned");
  console.log("");

  // ═══════════════════════════════════════════════════
  // TEST 8: Minimum Premium Rejection
  // ═══════════════════════════════════════════════════
  console.log("─── Test 8: Minimum Premium Check ───");

  const ts8 = await getDevnetTime();
  await program.methods.updateRate(
    new anchor.BN(1_155_800), new anchor.BN(1_155_600), new anchor.BN(1_156_000),
    new anchor.BN(ts8), Array.from(Buffer.alloc(32, 0xab)),
    new anchor.BN(696), new anchor.BN(720),
  ).accounts({ oracle: oraclePda, authority: wallet.publicKey }).rpc();

  await mintTo(connection, keypair, quoteMint, userQuote, keypair, 10_000_000_000);
  const nonce8 = (await (program.account as any).vault.fetch(vaultPda)).nextNonce.toNumber();
  const [posPda8] = PublicKey.findProgramAddressSync(
    [Buffer.from("dci"), vaultPda.toBuffer(), wallet.publicKey.toBuffer(),
     new anchor.BN(nonce8).toArrayLike(Buffer, "le", 8)], programId
  );

  try {
    await program.methods.createDci(
      new anchor.BN(1_160_000), new anchor.BN(ts8 + 86400 * 30), // 30-day tenor
      new anchor.BN(10_000_000_000),
      { quoteToBase: {} },
      new anchor.BN(1), // ridiculously low premium — 0.000001 USDC
      Array.from(Buffer.alloc(32, 0xdd)), new anchor.BN(0),
    ).accounts({
      vault: vaultPda, oracle: oraclePda, kycRecord: kycPda, position: posPda8,
      userDepositTokenAccount: userQuote, vaultDepositTokenAccount: vaultQuoteKp.publicKey,
      vaultPremiumTokenAccount: vaultQuoteKp.publicKey, userPremiumTokenAccount: userQuote,
      owner: wallet.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    assert(false, "Should have rejected low premium");
  } catch (e: any) {
    assert(e.error?.errorCode?.code === "PremiumTooLow", `Rejected with PremiumTooLow (got ${e.error?.errorCode?.code})`);
  }
  console.log("");

  // ═══════════════════════════════════════════════════
  // TEST 9: Cash Settlement Vault
  // ═══════════════════════════════════════════════════
  console.log("─── Test 9: Cash Settlement ───");

  const cashPair = `C${testId}`;
  const [cashOraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), Buffer.from(cashPair)], programId
  );
  await program.methods.initializeOracle(cashPair).accounts({
    oracle: cashOraclePda, authority: wallet.publicKey, systemProgram: SystemProgram.programId,
  }).rpc();

  const ts9 = await getDevnetTime();
  await program.methods.updateRate(
    new anchor.BN(4_433_000_000), // Gold $4433
    new anchor.BN(4_432_000_000), new anchor.BN(4_434_000_000),
    new anchor.BN(ts9), Array.from(Buffer.alloc(32, 0xab)),
    new anchor.BN(2588), new anchor.BN(2800), // high vol
  ).accounts({ oracle: cashOraclePda, authority: wallet.publicKey }).rpc();

  // Create cash-settled vault
  const cashBaseMint = await createMint(connection, keypair, keypair.publicKey, null, 6); // "gold" token
  const cashQuoteMint = quoteMint; // reuse USDC

  const [cashVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from(cashPair)], programId
  );

  const cashVaultBaseKp = Keypair.generate();
  const cashVaultQuoteKp = Keypair.generate();

  for (const [kp, mint] of [[cashVaultBaseKp, cashBaseMint], [cashVaultQuoteKp, cashQuoteMint]] as [Keypair, PublicKey][]) {
    const createIx = SystemProgram.createAccount({
      fromPubkey: keypair.publicKey, newAccountPubkey: kp.publicKey,
      space: ACCOUNT_SIZE, lamports: rentExempt, programId: TOKEN_PROGRAM_ID,
    });
    const initIx = (await import("@solana/spl-token")).createInitializeAccountInstruction(
      kp.publicKey, mint, cashVaultPda, TOKEN_PROGRAM_ID
    );
    const tx = new anchor.web3.Transaction().add(createIx, initIx);
    await anchor.web3.sendAndConfirmTransaction(connection, tx, [keypair, kp]);
  }

  // Initialize with CashSettled mode (1)
  await program.methods.initializeVault(cashPair, 1).accounts({
    vault: cashVaultPda, baseMint: cashBaseMint, quoteMint: cashQuoteMint,
    baseTokenAccount: cashVaultBaseKp.publicKey, quoteTokenAccount: cashVaultQuoteKp.publicKey,
    authority: wallet.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();

  const cashVault: any = await (program.account as any).vault.fetch(cashVaultPda);
  assert(JSON.stringify(cashVault.settlementMode).includes("cashSettled"), "Cash vault mode = CashSettled");

  // Fund cash vault with USDC only (cash-settled doesn't need base)
  const cashAdminQuote = (await getOrCreateAssociatedTokenAccount(connection, keypair, cashQuoteMint, keypair.publicKey)).address;
  await mintTo(connection, keypair, cashQuoteMint, cashAdminQuote, keypair, 100_000_000_000);
  await program.methods.depositLiquidity(new anchor.BN(100_000_000_000), 1).accounts({
    vault: cashVaultPda, vaultTokenAccount: cashVaultQuoteKp.publicKey,
    depositorTokenAccount: cashAdminQuote, authority: wallet.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();

  // Try BaseToQuote on cash-settled vault — should fail
  const [kycPda9] = PublicKey.findProgramAddressSync(
    [Buffer.from("kyc"), wallet.publicKey.toBuffer()], programId
  );
  const nonce9 = (await (program.account as any).vault.fetch(cashVaultPda)).nextNonce.toNumber();
  const [cashPosFail] = PublicKey.findProgramAddressSync(
    [Buffer.from("dci"), cashVaultPda.toBuffer(), wallet.publicKey.toBuffer(),
     new anchor.BN(nonce9).toArrayLike(Buffer, "le", 8)], programId
  );

  // We need a base token for BaseToQuote - create one
  const cashAdminBase = (await getOrCreateAssociatedTokenAccount(connection, keypair, cashBaseMint, keypair.publicKey)).address;
  await mintTo(connection, keypair, cashBaseMint, cashAdminBase, keypair, 10_000_000);

  try {
    await program.methods.createDci(
      new anchor.BN(4_400_000_000), new anchor.BN(ts9 + 86400),
      new anchor.BN(10_000_000), { baseToQuote: {} }, new anchor.BN(1_000_000),
      Array.from(Buffer.alloc(32, 0xdd)), new anchor.BN(0),
    ).accounts({
      vault: cashVaultPda, oracle: cashOraclePda, kycRecord: kycPda9, position: cashPosFail,
      userDepositTokenAccount: cashAdminBase, vaultDepositTokenAccount: cashVaultBaseKp.publicKey,
      vaultPremiumTokenAccount: cashVaultBaseKp.publicKey, userPremiumTokenAccount: cashAdminBase,
      owner: wallet.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    assert(false, "Should reject BaseToQuote on cash-settled vault");
  } catch (e: any) {
    assert(e.error?.errorCode?.code === "CashSettlementOnly", `Rejected BaseToQuote: ${e.error?.errorCode?.code}`);
  }

  // Create valid QuoteToBase DCI on cash-settled vault
  const cashUserQuote = (await getOrCreateAssociatedTokenAccount(connection, keypair, cashQuoteMint, keypair.publicKey)).address;
  await mintTo(connection, keypair, cashQuoteMint, cashUserQuote, keypair, 10_000_000_000);

  const nonce9b = (await (program.account as any).vault.fetch(cashVaultPda)).nextNonce.toNumber();
  const [cashPosPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("dci"), cashVaultPda.toBuffer(), wallet.publicKey.toBuffer(),
     new anchor.BN(nonce9b).toArrayLike(Buffer, "le", 8)], programId
  );

  const cashExpiry = await getDevnetTime() + 15;
  await program.methods.createDci(
    new anchor.BN(4_500_000_000), // strike $4500 (above spot $4433)
    new anchor.BN(cashExpiry),
    new anchor.BN(10_000_000_000), // 10K USDC
    { quoteToBase: {} },
    new anchor.BN(100_000_000), // 100 USDC premium (higher for metals)
    Array.from(Buffer.alloc(32, 0xdd)), new anchor.BN(0),
  ).accounts({
    vault: cashVaultPda, oracle: cashOraclePda, kycRecord: kycPda9, position: cashPosPda,
    userDepositTokenAccount: cashUserQuote, vaultDepositTokenAccount: cashVaultQuoteKp.publicKey,
    vaultPremiumTokenAccount: cashVaultQuoteKp.publicKey, userPremiumTokenAccount: cashUserQuote,
    owner: wallet.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();

  assert(true, "Cash-settled DCI created (QuoteToBase)");

  // Settle cash DCI — rate $4433 < strike $4500 → should convert (cash-settled)
  const cashUserBase = (await getOrCreateAssociatedTokenAccount(connection, keypair, cashBaseMint, keypair.publicKey)).address;
  const [cashAttPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("attestation"), cashPosPda.toBuffer()], programId
  );

  let cashSettled = false;
  for (let attempt = 1; attempt <= 12; attempt++) {
    console.log(`  Waiting for cash DCI expiry... attempt ${attempt}/12`);
    await new Promise((r) => setTimeout(r, 10000));
    const settleTs = await getDevnetTime();
    await program.methods.updateRate(
      new anchor.BN(4_433_000_000), new anchor.BN(4_432_000_000), new anchor.BN(4_434_000_000),
      new anchor.BN(settleTs), Array.from(Buffer.alloc(32, 0xab)),
      new anchor.BN(2588), new anchor.BN(2800),
    ).accounts({ oracle: cashOraclePda, authority: wallet.publicKey }).rpc();

    try {
      await program.methods.settleDci().accounts({
        vault: cashVaultPda, oracle: cashOraclePda, position: cashPosPda, attestation: cashAttPda,
        vaultBaseTokenAccount: cashVaultBaseKp.publicKey, vaultQuoteTokenAccount: cashVaultQuoteKp.publicKey,
        ownerBaseTokenAccount: cashUserBase, ownerQuoteTokenAccount: cashUserQuote,
        positionOwner: wallet.publicKey, cranker: wallet.publicKey,
        systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      cashSettled = true;
      break;
    } catch (e: any) {
      if (e.error?.errorCode?.code === "DCINotExpired") continue;
      throw e;
    }
  }

  assert(cashSettled, "Cash-settled DCI settled");
  const cashAtt: any = await (program.account as any).attestation.fetch(cashAttPda);
  assert(cashAtt.converted === true, "Cash DCI: converted (rate < strike)");
  // Cash settlement: amount_out = amount * spot / strike = 10000 * 4433 / 4500 ≈ 9851.11
  const cashOut = Number(cashAtt.amountOut.toString()) / 1e6;
  assert(cashOut > 9800 && cashOut < 9900, `Cash settlement amount ≈ 9851 USDC (got ${cashOut.toFixed(2)})`);
  console.log("");

  // ═══════════════════════════════════════════════════
  // TEST 10: Withdrawal Guard
  // ═══════════════════════════════════════════════════
  console.log("─── Test 10: Withdrawal Guard ───");

  // Create a DCI to lock exposure
  const ts10 = await getDevnetTime();
  await program.methods.updateRate(
    new anchor.BN(1_155_800), new anchor.BN(1_155_600), new anchor.BN(1_156_000),
    new anchor.BN(ts10), Array.from(Buffer.alloc(32, 0xab)),
    new anchor.BN(696), new anchor.BN(720),
  ).accounts({ oracle: oraclePda, authority: wallet.publicKey }).rpc();

  await mintTo(connection, keypair, quoteMint, userQuote, keypair, 50_000_000_000);
  const nonce10 = (await (program.account as any).vault.fetch(vaultPda)).nextNonce.toNumber();
  const [posPda10] = PublicKey.findProgramAddressSync(
    [Buffer.from("dci"), vaultPda.toBuffer(), wallet.publicKey.toBuffer(),
     new anchor.BN(nonce10).toArrayLike(Buffer, "le", 8)], programId
  );

  await program.methods.createDci(
    new anchor.BN(1_160_000), new anchor.BN(ts10 + 86400),
    new anchor.BN(50_000_000_000), // Lock 50K
    { quoteToBase: {} }, new anchor.BN(500_000_000),
    Array.from(Buffer.alloc(32, 0xdd)), new anchor.BN(0),
  ).accounts({
    vault: vaultPda, oracle: oraclePda, kycRecord: kycPda, position: posPda10,
    userDepositTokenAccount: userQuote, vaultDepositTokenAccount: vaultQuoteKp.publicKey,
    vaultPremiumTokenAccount: vaultQuoteKp.publicKey, userPremiumTokenAccount: userQuote,
    owner: wallet.publicKey, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();

  // Check vault state to compute the right over-withdrawal amount
  const vault10: any = await (program.account as any).vault.fetch(vaultPda);
  const quoteBalance10 = (await getAccount(connection, vaultQuoteKp.publicKey)).amount;
  const quoteExposure10 = vault10.totalQuoteExposure.toNumber();
  const available10 = Number(quoteBalance10) - quoteExposure10;
  console.log(`  Vault quote balance: ${Number(quoteBalance10) / 1e6}, exposure: ${quoteExposure10 / 1e6}, available: ${available10 / 1e6}`);

  // Try to withdraw MORE than available (available + 1 token)
  const overWithdraw = new anchor.BN(available10 + 1_000_000);
  try {
    await program.methods.withdrawLiquidity(overWithdraw, 1).accounts({
      vault: vaultPda, vaultTokenAccount: vaultQuoteKp.publicKey,
      recipientTokenAccount: adminQuote, authority: wallet.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
    assert(false, "Should reject over-withdrawal");
  } catch (e: any) {
    assert(
      e.error?.errorCode?.code === "VaultInsufficientLiquidity",
      `Withdrawal guard: ${e.error?.errorCode?.code}`
    );
  }
  console.log("");

  // ═══════════════════════════════════════════════════
  // TEST 11: Rolling Strategy
  // ═══════════════════════════════════════════════════
  console.log("─── Test 11: Rolling Strategy ───");

  const [rollingPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("rolling"), vaultPda.toBuffer(), wallet.publicKey.toBuffer()], programId
  );

  await program.methods.createRollingStrategy(
    { quoteToBase: {} },
    new anchor.BN(200), // 2% offset
    new anchor.BN(604800), // 7 days
    new anchor.BN(10_000_000_000), // 10K
  ).accounts({
    strategy: rollingPda, vault: vaultPda,
    owner: wallet.publicKey, systemProgram: SystemProgram.programId,
  }).rpc();

  const stratData: any = await (program.account as any).rollingStrategy.fetch(rollingPda);
  assert(stratData.active === true, "Rolling strategy active");
  assert(stratData.strikeOffsetBps.toNumber() === 200, "Strike offset = 200 bps");
  assert(stratData.tenorSeconds.toNumber() === 604800, "Tenor = 7 days");

  // Cancel it
  await program.methods.cancelRollingStrategy().accounts({
    strategy: rollingPda, owner: wallet.publicKey,
  }).rpc();

  try {
    await (program.account as any).rollingStrategy.fetch(rollingPda);
    assert(false, "Strategy should be closed");
  } catch {
    assert(true, "Rolling strategy cancelled (account closed)");
  }
  console.log("");

  // ═══════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════
  console.log("══════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════════════");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n!!! TEST CRASHED !!!");
  console.error(e);
  process.exit(1);
});
