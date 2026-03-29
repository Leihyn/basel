import * as anchor from "@coral-xyz/anchor";
import {
  Connection, Keypair, PublicKey, SystemProgram,
} from "@solana/web3.js";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount,
  TOKEN_PROGRAM_ID, ACCOUNT_SIZE, createInitializeAccountInstruction,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { assert } from "chai";

// ────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────

const RPC = "https://api.devnet.solana.com";
const IDL_PATH = path.resolve(__dirname, "../target/idl/basel.json");

// ────────────────────────────────────────────────────────────────
// Shared state across tests
// ────────────────────────────────────────────────────────────────

let connection: Connection;
let keypair: Keypair;
let wallet: anchor.Wallet;
let program: anchor.Program;
let programId: PublicKey;

// Unique per run to avoid PDA collisions
const testId = Date.now().toString().slice(-4);
const pair = `T${testId}`;

// PDAs
let oraclePda: PublicKey;
let vaultPda: PublicKey;
let kycPda: PublicKey;

// Token mints & vault token accounts
let baseMint: PublicKey;
let quoteMint: PublicKey;
let vaultBaseKp: Keypair;
let vaultQuoteKp: Keypair;

// User token accounts
let userBase: PublicKey;
let userQuote: PublicKey;

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

async function getDevnetTime(): Promise<number> {
  const s = await connection.getSlot();
  return (await connection.getBlockTime(s)) || Math.floor(Date.now() / 1000);
}

async function refreshOracle(
  oracle: PublicKey,
  rate: number,
  bid?: number,
  ask?: number,
  vol30d = 696,
  vol90d = 720,
) {
  const ts = await getDevnetTime();
  await program.methods.updateRate(
    new anchor.BN(rate),
    new anchor.BN(bid ?? rate - 1000),
    new anchor.BN(ask ?? rate + 1000),
    new anchor.BN(ts),
    Array.from(Buffer.alloc(32, 0xab)),
    new anchor.BN(vol30d),
    new anchor.BN(vol90d),
  ).accounts({ oracle, authority: wallet.publicKey }).rpc();
}

async function createVaultTokenAccount(mint: PublicKey, vaultPdaKey: PublicKey): Promise<Keypair> {
  const kp = Keypair.generate();
  const rentExempt = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
  const createIx = SystemProgram.createAccount({
    fromPubkey: keypair.publicKey,
    newAccountPubkey: kp.publicKey,
    space: ACCOUNT_SIZE,
    lamports: rentExempt,
    programId: TOKEN_PROGRAM_ID,
  });
  const initIx = createInitializeAccountInstruction(kp.publicKey, mint, vaultPdaKey, TOKEN_PROGRAM_ID);
  const tx = new anchor.web3.Transaction().add(createIx, initIx);
  await anchor.web3.sendAndConfirmTransaction(connection, tx, [keypair, kp]);
  return kp;
}

/** Create a DCI position and return its PDA */
async function createPosition(opts: {
  vault: PublicKey;
  oracle: PublicKey;
  kyc: PublicKey;
  strike: number;
  expiryOffset: number; // seconds from devnet now
  amount: number; // raw units (e.g. 10_000_000_000 = 10K)
  direction: "baseToQuote" | "quoteToBase";
  premium: number;
  strikeUpper?: number;
  userDeposit: PublicKey;
  vaultDeposit: PublicKey;
  vaultPremium: PublicKey;
  userPremium: PublicKey;
}): Promise<PublicKey> {
  const vaultData: any = await (program.account as any).vault.fetch(opts.vault);
  const nonce = vaultData.nextNonce.toNumber();
  const [posPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("dci"), opts.vault.toBuffer(), wallet.publicKey.toBuffer(),
     new anchor.BN(nonce).toArrayLike(Buffer, "le", 8)],
    programId,
  );

  const expiry = await getDevnetTime() + opts.expiryOffset;
  const dir = opts.direction === "baseToQuote" ? { baseToQuote: {} } : { quoteToBase: {} };

  await program.methods.createDci(
    new anchor.BN(opts.strike),
    new anchor.BN(expiry),
    new anchor.BN(opts.amount),
    dir,
    new anchor.BN(opts.premium),
    Array.from(Buffer.alloc(32, 0xdd)),
    new anchor.BN(opts.strikeUpper || 0),
  ).accounts({
    vault: opts.vault, oracle: opts.oracle, kycRecord: opts.kyc, position: posPda,
    userDepositTokenAccount: opts.userDeposit,
    vaultDepositTokenAccount: opts.vaultDeposit,
    vaultPremiumTokenAccount: opts.vaultPremium,
    userPremiumTokenAccount: opts.userPremium,
    owner: wallet.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
  }).rpc();

  return posPda;
}

/** Wait for devnet clock to pass expiry, then settle. Returns attestation data. */
async function settlePosition(
  positionPda: PublicKey,
  vault: PublicKey,
  oracle: PublicKey,
  vaultBaseAcc: PublicKey,
  vaultQuoteAcc: PublicKey,
  ownerBaseAcc: PublicKey,
  ownerQuoteAcc: PublicKey,
  oracleRate?: number, // if provided, refreshes oracle to this rate before settling
): Promise<any> {
  const [attPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("attestation"), positionPda.toBuffer()], programId,
  );

  // If a specific rate is requested, fill the ring buffer (6 obs) so TWAP converges
  if (oracleRate !== undefined) {
    for (let i = 0; i < 6; i++) {
      await refreshOracle(oracle, oracleRate);
    }
  }

  for (let attempt = 1; attempt <= 20; attempt++) {
    if (oracleRate !== undefined) {
      await refreshOracle(oracle, oracleRate);
    } else {
      // Just refresh timestamp so oracle isn't stale
      const oracleData: any = await (program.account as any).oracleRate.fetch(oracle);
      await refreshOracle(oracle, oracleData.rate.toNumber());
    }

    try {
      await program.methods.settleDci().accounts({
        vault, oracle, position: positionPda, attestation: attPda,
        vaultBaseTokenAccount: vaultBaseAcc, vaultQuoteTokenAccount: vaultQuoteAcc,
        ownerBaseTokenAccount: ownerBaseAcc, ownerQuoteTokenAccount: ownerQuoteAcc,
        positionOwner: wallet.publicKey, cranker: wallet.publicKey,
        systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

      // Fetch results
      const pos: any = await (program.account as any).dciPosition.fetch(positionPda);
      const att: any = await (program.account as any).attestation.fetch(attPda);
      return { position: pos, attestation: att };
    } catch (e: any) {
      if (e.error?.errorCode?.code === "DCINotExpired") {
        await new Promise((r) => setTimeout(r, 8000));
        continue;
      }
      throw e;
    }
  }
  throw new Error("Settlement timed out — devnet clock too slow");
}

// ════════════════════════════════════════════════════════════════
// TEST SUITE
// ════════════════════════════════════════════════════════════════

describe("Basel DCI Vault", function () {
  this.timeout(600_000); // 10 min total

  before(async function () {
    // Load keypair and program
    const keypairData = JSON.parse(
      fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf-8"),
    );
    keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    wallet = new anchor.Wallet(keypair);
    connection = new Connection(RPC, "confirmed");
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    anchor.setProvider(provider);

    const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf-8"));
    program = new anchor.Program(idl as any, provider);
    programId = program.programId;

    console.log(`    Program: ${programId.toBase58()}`);
    console.log(`    Test pair: ${pair}`);

    // Derive PDAs
    [oraclePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle"), Buffer.from(pair)], programId,
    );
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), Buffer.from(pair)], programId,
    );
    [kycPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("kyc"), wallet.publicKey.toBuffer()], programId,
    );
  });

  // ──────────────────────────────────────────────────────────────
  // 1. Oracle + TWAP
  // ──────────────────────────────────────────────────────────────

  describe("Oracle + TWAP", function () {
    it("initializes oracle and accepts rate updates", async function () {
      await program.methods.initializeOracle(pair).accounts({
        oracle: oraclePda, authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      }).rpc();

      await refreshOracle(oraclePda, 1_100_000);
      const data: any = await (program.account as any).oracleRate.fetch(oraclePda);
      assert.equal(data.rate.toNumber(), 1_100_000, "rate should be 1.10");
    });

    it("computes TWAP from multiple observations", async function () {
      // Push 2 more rates (already have 1 from previous test)
      await refreshOracle(oraclePda, 1_200_000);
      await refreshOracle(oraclePda, 1_300_000);

      const data: any = await (program.account as any).oracleRate.fetch(oraclePda);
      assert.equal(data.obsCount, 3, "should have 3 observations");

      const expectedTwap = Math.floor((1_100_000 + 1_200_000 + 1_300_000) / 3);
      assert.approximately(data.twap.toNumber(), expectedTwap, 1, "TWAP should average 3 rates");
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 2. KYC
  // ──────────────────────────────────────────────────────────────

  describe("KYC", function () {
    it("approves wallet with level 2", async function () {
      let exists = false;
      try { await (program.account as any).kycRecord.fetch(kycPda); exists = true; } catch {}

      if (!exists) {
        await program.methods.approveWallet(
          wallet.publicKey, 2,
          new anchor.BN(Math.floor(Date.now() / 1000) + 86400 * 365),
          Array.from(Buffer.alloc(32, 0xcc)),
        ).accounts({
          kycRecord: kycPda, authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        }).rpc();
      }

      const data: any = await (program.account as any).kycRecord.fetch(kycPda);
      assert.equal(data.kycLevel, 2);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 3. Vault Setup
  // ──────────────────────────────────────────────────────────────

  describe("Vault", function () {
    it("initializes physical settlement vault with token accounts", async function () {
      baseMint = await createMint(connection, keypair, keypair.publicKey, null, 6);
      quoteMint = await createMint(connection, keypair, keypair.publicKey, null, 6);

      vaultBaseKp = await createVaultTokenAccount(baseMint, vaultPda);
      vaultQuoteKp = await createVaultTokenAccount(quoteMint, vaultPda);

      await program.methods.initializeVault(pair, 0).accounts({
        vault: vaultPda, baseMint, quoteMint,
        baseTokenAccount: vaultBaseKp.publicKey,
        quoteTokenAccount: vaultQuoteKp.publicKey,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

      const data: any = await (program.account as any).vault.fetch(vaultPda);
      assert.equal(data.pair, pair);
      assert.isTrue(JSON.stringify(data.settlementMode).includes("physical"));
    });

    it("accepts liquidity deposits", async function () {
      this.timeout(120_000); // 2 min for devnet latency
      const adminBase = (await getOrCreateAssociatedTokenAccount(connection, keypair, baseMint, keypair.publicKey)).address;
      const adminQuote = (await getOrCreateAssociatedTokenAccount(connection, keypair, quoteMint, keypair.publicKey)).address;

      await mintTo(connection, keypair, baseMint, adminBase, keypair, 2_000_000_000_000); // 2M
      await mintTo(connection, keypair, quoteMint, adminQuote, keypair, 2_000_000_000_000);

      await program.methods.depositLiquidity(new anchor.BN(2_000_000_000_000), 0).accounts({
        vault: vaultPda, vaultTokenAccount: vaultBaseKp.publicKey,
        depositorTokenAccount: adminBase, authority: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      await program.methods.depositLiquidity(new anchor.BN(2_000_000_000_000), 1).accounts({
        vault: vaultPda, vaultTokenAccount: vaultQuoteKp.publicKey,
        depositorTokenAccount: adminQuote, authority: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

      const baseBalance = await getAccount(connection, vaultBaseKp.publicKey);
      const quoteBalance = await getAccount(connection, vaultQuoteKp.publicKey);
      assert.isAbove(Number(baseBalance.amount), 0, "vault has base tokens");
      assert.isAbove(Number(quoteBalance.amount), 0, "vault has quote tokens");
    });

    it("creates user token accounts", async function () {
      userBase = (await getOrCreateAssociatedTokenAccount(connection, keypair, baseMint, keypair.publicKey)).address;
      userQuote = (await getOrCreateAssociatedTokenAccount(connection, keypair, quoteMint, keypair.publicKey)).address;
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 4. Settlement Math — THE CORE TESTS
  // ──────────────────────────────────────────────────────────────

  describe("Settlement Math", function () {
    // All positions share a short expiry so we batch the wait.
    // We create them, wait once, then settle each with a specific oracle rate.

    const EXPIRY_OFFSET = 20; // 20s from devnet time

    // Helpers that mint fresh tokens before each position
    async function mintUserTokens(amount: number) {
      await mintTo(connection, keypair, quoteMint, userQuote, keypair, amount);
    }
    async function mintUserBase(amount: number) {
      await mintTo(connection, keypair, baseMint, userBase, keypair, amount);
    }

    // ── 4a. QuoteToBase: rate < strike → Physical conversion ────

    it("QuoteToBase: rate < strike → converts to base (physical)", async function () {
      // Deposit 10K USDC, strike 1.16, oracle will be 1.10 (< strike) → convert
      // Expected: amount_out = 10_000_000_000 * 1_000_000 / 1_160_000 = 8_620_689_655
      await mintUserTokens(10_000_000_000);
      await refreshOracle(oraclePda, 1_155_800); // current rate for creation

      const posPda = await createPosition({
        vault: vaultPda, oracle: oraclePda, kyc: kycPda,
        strike: 1_160_000, expiryOffset: EXPIRY_OFFSET,
        amount: 10_000_000_000, direction: "quoteToBase",
        premium: 30_000_000,
        userDeposit: userQuote, vaultDeposit: vaultQuoteKp.publicKey,
        vaultPremium: vaultQuoteKp.publicKey, userPremium: userQuote,
      });

      // Settle with rate 1.10 (below strike 1.16) — should convert
      const result = await settlePosition(
        posPda, vaultPda, oraclePda,
        vaultBaseKp.publicKey, vaultQuoteKp.publicKey,
        userBase, userQuote,
        1_100_000, // settlement rate
      );

      assert.isTrue(result.attestation.converted, "should convert when rate < strike");
      // Physical: out = amount * 1e6 / strike = 10_000_000_000 * 1_000_000 / 1_160_000
      const expectedOut = Math.floor((10_000_000_000 * 1_000_000) / 1_160_000);
      assert.equal(
        result.position.settlementAmount.toNumber(), expectedOut,
        `physical conversion: ${expectedOut / 1e6} base tokens`,
      );
    });

    // ── 4b. QuoteToBase: rate >= strike → no conversion ─────────

    it("QuoteToBase: rate >= strike → returns deposit unchanged", async function () {
      await mintUserTokens(10_000_000_000);
      await refreshOracle(oraclePda, 1_155_800);

      const posPda = await createPosition({
        vault: vaultPda, oracle: oraclePda, kyc: kycPda,
        strike: 1_100_000, expiryOffset: EXPIRY_OFFSET,
        amount: 10_000_000_000, direction: "quoteToBase",
        premium: 30_000_000,
        userDeposit: userQuote, vaultDeposit: vaultQuoteKp.publicKey,
        vaultPremium: vaultQuoteKp.publicKey, userPremium: userQuote,
      });

      // Settle with rate 1.20 (above strike 1.10) — no conversion
      const result = await settlePosition(
        posPda, vaultPda, oraclePda,
        vaultBaseKp.publicKey, vaultQuoteKp.publicKey,
        userBase, userQuote,
        1_200_000,
      );

      assert.isFalse(result.attestation.converted, "should NOT convert when rate >= strike");
      assert.equal(
        result.position.settlementAmount.toNumber(), 10_000_000_000,
        "full deposit returned",
      );
    });

    // ── 4c. BaseToQuote: rate >= strike → converts ──────────────

    it("BaseToQuote: rate >= strike → converts to quote", async function () {
      // Deposit 10K base, strike 1.10. Rate will be 1.20 (>= strike) → convert
      // Expected: out = amount * strike / 1e6 = 10_000_000_000 * 1_100_000 / 1_000_000
      await mintUserBase(10_000_000_000);
      await refreshOracle(oraclePda, 1_155_800);

      const posPda = await createPosition({
        vault: vaultPda, oracle: oraclePda, kyc: kycPda,
        strike: 1_100_000, expiryOffset: EXPIRY_OFFSET,
        amount: 10_000_000_000, direction: "baseToQuote",
        premium: 30_000_000,
        userDeposit: userBase, vaultDeposit: vaultBaseKp.publicKey,
        vaultPremium: vaultBaseKp.publicKey, userPremium: userBase,
      });

      // Settle with rate 1.20 (above strike 1.10) — should convert
      const result = await settlePosition(
        posPda, vaultPda, oraclePda,
        vaultBaseKp.publicKey, vaultQuoteKp.publicKey,
        userBase, userQuote,
        1_200_000,
      );

      assert.isTrue(result.attestation.converted);
      // out = 10_000_000_000 * 1_100_000 / 1_000_000 = 11_000_000_000
      const expectedOut = Math.floor((10_000_000_000 * 1_100_000) / 1_000_000);
      assert.equal(result.position.settlementAmount.toNumber(), expectedOut);
    });

    // ── 4d. BaseToQuote: rate < strike → no conversion ──────────

    it("BaseToQuote: rate < strike → returns base deposit unchanged", async function () {
      await mintUserBase(10_000_000_000);
      await refreshOracle(oraclePda, 1_155_800);

      const posPda = await createPosition({
        vault: vaultPda, oracle: oraclePda, kyc: kycPda,
        strike: 1_300_000, expiryOffset: EXPIRY_OFFSET,
        amount: 10_000_000_000, direction: "baseToQuote",
        premium: 30_000_000,
        userDeposit: userBase, vaultDeposit: vaultBaseKp.publicKey,
        vaultPremium: vaultBaseKp.publicKey, userPremium: userBase,
      });

      // Settle with rate 1.15 (below strike 1.30) — no conversion
      const result = await settlePosition(
        posPda, vaultPda, oraclePda,
        vaultBaseKp.publicKey, vaultQuoteKp.publicKey,
        userBase, userQuote,
        1_150_000,
      );

      assert.isFalse(result.attestation.converted);
      assert.equal(result.position.settlementAmount.toNumber(), 10_000_000_000);
    });

    // ── 4e. QuoteToBase: exactly at strike → no conversion ──────

    it("QuoteToBase: exactly at strike → NO conversion (rate must be strictly less)", async function () {
      await mintUserTokens(10_000_000_000);
      await refreshOracle(oraclePda, 1_155_800);

      const posPda = await createPosition({
        vault: vaultPda, oracle: oraclePda, kyc: kycPda,
        strike: 1_155_800, expiryOffset: EXPIRY_OFFSET,
        amount: 10_000_000_000, direction: "quoteToBase",
        premium: 30_000_000,
        userDeposit: userQuote, vaultDeposit: vaultQuoteKp.publicKey,
        vaultPremium: vaultQuoteKp.publicKey, userPremium: userQuote,
      });

      // Settle at exactly strike — QuoteToBase uses strict < so should NOT convert
      const result = await settlePosition(
        posPda, vaultPda, oraclePda,
        vaultBaseKp.publicKey, vaultQuoteKp.publicKey,
        userBase, userQuote,
        1_155_800, // exactly at strike
      );

      assert.isFalse(result.attestation.converted, "exactly at strike: no conversion for Q2B");
      assert.equal(result.position.settlementAmount.toNumber(), 10_000_000_000);
    });

    // ── 4f. BaseToQuote: exactly at strike → CONVERTS ───────────

    it("BaseToQuote: exactly at strike → CONVERTS (rate >= strike)", async function () {
      await mintUserBase(10_000_000_000);
      await refreshOracle(oraclePda, 1_155_800);

      const posPda = await createPosition({
        vault: vaultPda, oracle: oraclePda, kyc: kycPda,
        strike: 1_155_800, expiryOffset: EXPIRY_OFFSET,
        amount: 10_000_000_000, direction: "baseToQuote",
        premium: 30_000_000,
        userDeposit: userBase, vaultDeposit: vaultBaseKp.publicKey,
        vaultPremium: vaultBaseKp.publicKey, userPremium: userBase,
      });

      // Settle at exactly strike — BaseToQuote uses >= so should convert
      const result = await settlePosition(
        posPda, vaultPda, oraclePda,
        vaultBaseKp.publicKey, vaultQuoteKp.publicKey,
        userBase, userQuote,
        1_155_800,
      );

      assert.isTrue(result.attestation.converted, "exactly at strike: B2Q converts");
      const expectedOut = Math.floor((10_000_000_000 * 1_155_800) / 1_000_000);
      assert.equal(result.position.settlementAmount.toNumber(), expectedOut);
    });

    // ── 4g. Range DCI: rate inside range → no conversion ────────

    it("Range DCI (QuoteToBase): rate inside range → no conversion", async function () {
      await mintUserTokens(5_000_000_000);
      await refreshOracle(oraclePda, 1_150_000);

      const posPda = await createPosition({
        vault: vaultPda, oracle: oraclePda, kyc: kycPda,
        strike: 1_100_000,       // lower strike
        strikeUpper: 1_200_000,  // upper strike
        expiryOffset: EXPIRY_OFFSET,
        amount: 5_000_000_000, direction: "quoteToBase",
        premium: 30_000_000,
        userDeposit: userQuote, vaultDeposit: vaultQuoteKp.publicKey,
        vaultPremium: vaultQuoteKp.publicKey, userPremium: userQuote,
      });

      // Rate 1.15 is INSIDE range [1.10, 1.20] → no conversion
      const result = await settlePosition(
        posPda, vaultPda, oraclePda,
        vaultBaseKp.publicKey, vaultQuoteKp.publicKey,
        userBase, userQuote,
        1_150_000,
      );

      assert.isFalse(result.attestation.converted, "inside range: no conversion");
      assert.equal(result.position.settlementAmount.toNumber(), 5_000_000_000);
    });

    // ── 4h. Range DCI: rate <= lower strike → converts ──────────

    it("Range DCI (QuoteToBase): rate at lower strike → converts", async function () {
      await mintUserTokens(5_000_000_000);
      await refreshOracle(oraclePda, 1_150_000);

      const posPda = await createPosition({
        vault: vaultPda, oracle: oraclePda, kyc: kycPda,
        strike: 1_100_000,
        strikeUpper: 1_200_000,
        expiryOffset: EXPIRY_OFFSET,
        amount: 5_000_000_000, direction: "quoteToBase",
        premium: 30_000_000,
        userDeposit: userQuote, vaultDeposit: vaultQuoteKp.publicKey,
        vaultPremium: vaultQuoteKp.publicKey, userPremium: userQuote,
      });

      // Rate 1.10 = lower strike → range Q2B converts when rate <= strike
      const result = await settlePosition(
        posPda, vaultPda, oraclePda,
        vaultBaseKp.publicKey, vaultQuoteKp.publicKey,
        userBase, userQuote,
        1_100_000,
      );

      assert.isTrue(result.attestation.converted, "at lower bound: converts");
      // Physical: out = 5_000_000_000 * 1_000_000 / 1_100_000
      const expectedOut = Math.floor((5_000_000_000 * 1_000_000) / 1_100_000);
      assert.equal(result.position.settlementAmount.toNumber(), expectedOut);
    });

    // ── 4i. Range DCI (BaseToQuote): rate >= upper → converts ───

    it("Range DCI (BaseToQuote): rate >= upper strike → converts", async function () {
      await mintUserBase(5_000_000_000);
      await refreshOracle(oraclePda, 1_150_000);

      const posPda = await createPosition({
        vault: vaultPda, oracle: oraclePda, kyc: kycPda,
        strike: 1_100_000,
        strikeUpper: 1_200_000,
        expiryOffset: EXPIRY_OFFSET,
        amount: 5_000_000_000, direction: "baseToQuote",
        premium: 30_000_000,
        userDeposit: userBase, vaultDeposit: vaultBaseKp.publicKey,
        vaultPremium: vaultBaseKp.publicKey, userPremium: userBase,
      });

      // Rate 1.25 >= upper strike 1.20 → should convert
      const result = await settlePosition(
        posPda, vaultPda, oraclePda,
        vaultBaseKp.publicKey, vaultQuoteKp.publicKey,
        userBase, userQuote,
        1_250_000,
      );

      assert.isTrue(result.attestation.converted, "above upper: converts");
      // B2Q: out = amount * strike / 1e6 (uses lower strike for conversion)
      const expectedOut = Math.floor((5_000_000_000 * 1_100_000) / 1_000_000);
      assert.equal(result.position.settlementAmount.toNumber(), expectedOut);
    });

    // ── 4j. TWAP preference over spot ───────────────────────────

    it("uses TWAP for settlement — settlement rate reflects average, not spot", async function () {
      await mintUserTokens(10_000_000_000);

      // Fill ring buffer with known values: 4 × 1.10 + 2 × 1.30
      // TWAP = (4*1.10 + 2*1.30) / 6 = 1.1667
      // Spot = 1.30 (last pushed)
      // Settlement should use TWAP (1.1667), not spot (1.30)
      for (let i = 0; i < 4; i++) {
        await refreshOracle(oraclePda, 1_100_000);
      }
      for (let i = 0; i < 2; i++) {
        await refreshOracle(oraclePda, 1_300_000);
      }

      // Verify TWAP is set as expected before creating position
      const oracleCheck: any = await (program.account as any).oracleRate.fetch(oraclePda);
      const twapBefore = oracleCheck.twap.toNumber();
      assert.isAbove(twapBefore, 0, "TWAP is available");
      assert.isBelow(twapBefore, 1_300_000, "TWAP < spot (1.30)");

      const posPda = await createPosition({
        vault: vaultPda, oracle: oraclePda, kyc: kycPda,
        strike: 1_250_000, // strike 1.25 — between TWAP (~1.17) and spot (1.30)
        expiryOffset: EXPIRY_OFFSET,
        amount: 10_000_000_000, direction: "quoteToBase",
        premium: 30_000_000,
        userDeposit: userQuote, vaultDeposit: vaultQuoteKp.publicKey,
        vaultPremium: vaultQuoteKp.publicKey, userPremium: userQuote,
      });

      // Settle — refresh with 1.10 to keep TWAP below strike during retries
      const [attPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("attestation"), posPda.toBuffer()], programId,
      );

      let result: any;
      for (let attempt = 1; attempt <= 20; attempt++) {
        // Push 1.10 to keep TWAP low (spot becomes 1.10, but TWAP still drags above)
        await refreshOracle(oraclePda, 1_100_000);
        try {
          await program.methods.settleDci().accounts({
            vault: vaultPda, oracle: oraclePda, position: posPda, attestation: attPda,
            vaultBaseTokenAccount: vaultBaseKp.publicKey,
            vaultQuoteTokenAccount: vaultQuoteKp.publicKey,
            ownerBaseTokenAccount: userBase, ownerQuoteTokenAccount: userQuote,
            positionOwner: wallet.publicKey, cranker: wallet.publicKey,
            systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
          }).rpc();

          const pos: any = await (program.account as any).dciPosition.fetch(posPda);
          const att: any = await (program.account as any).attestation.fetch(attPda);
          result = { position: pos, attestation: att };
          break;
        } catch (e: any) {
          if (e.error?.errorCode?.code === "DCINotExpired") {
            await new Promise((r) => setTimeout(r, 8000));
            continue;
          }
          throw e;
        }
      }

      assert.isDefined(result, "settlement completed");
      const settlementRate = result.position.settlementRate.toNumber();
      // Key assertion: settlement rate should NOT equal spot (1.10) —
      // it should be the TWAP which is higher due to the 1.30 observations still in buffer
      assert.notEqual(settlementRate, 1_100_000, "settlement rate ≠ spot — TWAP was used");
      assert.isAbove(settlementRate, 1_100_000, "TWAP > spot confirms ring buffer averaging");
      // The position should have converted because TWAP < strike 1.25
      assert.isTrue(result.attestation.converted, "TWAP < strike caused conversion");
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 5. Cash Settlement
  // ──────────────────────────────────────────────────────────────

  describe("Cash Settlement", function () {
    const cashPair = `C${testId}`;
    let cashOraclePda: PublicKey;
    let cashVaultPda: PublicKey;
    let cashBaseMint: PublicKey;
    let cashVaultBaseKp: Keypair;
    let cashVaultQuoteKp: Keypair;
    let cashUserBase: PublicKey;
    let cashUserQuote: PublicKey;

    before(async function () {
      // Initialize cash-settled oracle + vault
      [cashOraclePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("oracle"), Buffer.from(cashPair)], programId,
      );
      [cashVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), Buffer.from(cashPair)], programId,
      );

      await program.methods.initializeOracle(cashPair).accounts({
        oracle: cashOraclePda, authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      }).rpc();

      // Gold-like rate: $3000
      await refreshOracle(cashOraclePda, 3_000_000_000, 2_999_000_000, 3_001_000_000, 2588, 2800);

      cashBaseMint = await createMint(connection, keypair, keypair.publicKey, null, 6);
      cashVaultBaseKp = await createVaultTokenAccount(cashBaseMint, cashVaultPda);
      cashVaultQuoteKp = await createVaultTokenAccount(quoteMint, cashVaultPda);

      // settlement_mode = 1 (CashSettled)
      await program.methods.initializeVault(cashPair, 1).accounts({
        vault: cashVaultPda, baseMint: cashBaseMint, quoteMint,
        baseTokenAccount: cashVaultBaseKp.publicKey,
        quoteTokenAccount: cashVaultQuoteKp.publicKey,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

      // Fund with USDC
      const adminQuote = (await getOrCreateAssociatedTokenAccount(connection, keypair, quoteMint, keypair.publicKey)).address;
      await mintTo(connection, keypair, quoteMint, adminQuote, keypair, 500_000_000_000);
      await program.methods.depositLiquidity(new anchor.BN(500_000_000_000), 1).accounts({
        vault: cashVaultPda, vaultTokenAccount: cashVaultQuoteKp.publicKey,
        depositorTokenAccount: adminQuote, authority: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

      cashUserBase = (await getOrCreateAssociatedTokenAccount(connection, keypair, cashBaseMint, keypair.publicKey)).address;
      cashUserQuote = (await getOrCreateAssociatedTokenAccount(connection, keypair, quoteMint, keypair.publicKey)).address;
    });

    it("rejects BaseToQuote on cash-settled vault", async function () {
      await mintTo(connection, keypair, cashBaseMint, cashUserBase, keypair, 10_000_000);
      await refreshOracle(cashOraclePda, 3_000_000_000, 2_999_000_000, 3_001_000_000, 2588, 2800);

      const vaultData: any = await (program.account as any).vault.fetch(cashVaultPda);
      const nonce = vaultData.nextNonce.toNumber();
      const [posPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("dci"), cashVaultPda.toBuffer(), wallet.publicKey.toBuffer(),
         new anchor.BN(nonce).toArrayLike(Buffer, "le", 8)], programId,
      );

      try {
        const ts = await getDevnetTime();
        await program.methods.createDci(
          new anchor.BN(3_000_000_000), new anchor.BN(ts + 86400),
          new anchor.BN(10_000_000), { baseToQuote: {} },
          new anchor.BN(1_000_000),
          Array.from(Buffer.alloc(32, 0xdd)), new anchor.BN(0),
        ).accounts({
          vault: cashVaultPda, oracle: cashOraclePda, kycRecord: kycPda,
          position: posPda,
          userDepositTokenAccount: cashUserBase,
          vaultDepositTokenAccount: cashVaultBaseKp.publicKey,
          vaultPremiumTokenAccount: cashVaultBaseKp.publicKey,
          userPremiumTokenAccount: cashUserBase,
          owner: wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
        assert.fail("should have rejected BaseToQuote on cash vault");
      } catch (e: any) {
        assert.equal(e.error?.errorCode?.code, "CashSettlementOnly");
      }
    });

    it("cash-settles QuoteToBase: returns reduced USDC instead of base tokens", async function () {
      // Deposit 10K USDC, strike $3200, oracle at $3000 (< strike) → convert
      // Cash: out = amount * rate / strike = 10K * 3000 / 3200 = 9375 USDC
      await mintTo(connection, keypair, quoteMint, cashUserQuote, keypair, 10_000_000_000);
      await refreshOracle(cashOraclePda, 3_000_000_000, 2_999_000_000, 3_001_000_000, 2588, 2800);

      const vaultData: any = await (program.account as any).vault.fetch(cashVaultPda);
      const nonce = vaultData.nextNonce.toNumber();
      const [posPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("dci"), cashVaultPda.toBuffer(), wallet.publicKey.toBuffer(),
         new anchor.BN(nonce).toArrayLike(Buffer, "le", 8)], programId,
      );
      const [attPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("attestation"), posPda.toBuffer()], programId,
      );

      const expiry = await getDevnetTime() + 20;
      await program.methods.createDci(
        new anchor.BN(3_200_000_000), // strike $3200
        new anchor.BN(expiry),
        new anchor.BN(10_000_000_000),
        { quoteToBase: {} },
        new anchor.BN(100_000_000), // 100 USDC premium
        Array.from(Buffer.alloc(32, 0xdd)),
        new anchor.BN(0),
      ).accounts({
        vault: cashVaultPda, oracle: cashOraclePda, kycRecord: kycPda,
        position: posPda,
        userDepositTokenAccount: cashUserQuote,
        vaultDepositTokenAccount: cashVaultQuoteKp.publicKey,
        vaultPremiumTokenAccount: cashVaultQuoteKp.publicKey,
        userPremiumTokenAccount: cashUserQuote,
        owner: wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

      // Settle — rate $3000 < strike $3200 → cash conversion
      const result = await settlePosition(
        posPda, cashVaultPda, cashOraclePda,
        cashVaultBaseKp.publicKey, cashVaultQuoteKp.publicKey,
        cashUserBase, cashUserQuote,
        3_000_000_000,
      );

      assert.isTrue(result.attestation.converted);
      // Cash: out = 10_000_000_000 * 3_000_000_000 / 3_200_000_000 = 9_375_000_000
      const expectedOut = Math.floor((10_000_000_000 * 3_000_000_000) / 3_200_000_000);
      assert.equal(result.position.settlementAmount.toNumber(), expectedOut,
        `cash settlement: ${expectedOut / 1e6} USDC (not base tokens)`,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 6. Access Control & Guards
  // ──────────────────────────────────────────────────────────────

  describe("Access Control", function () {
    it("rejects settlement before expiry", async function () {
      await mintTo(connection, keypair, quoteMint, userQuote, keypair, 10_000_000_000);
      await refreshOracle(oraclePda, 1_155_800);

      const posPda = await createPosition({
        vault: vaultPda, oracle: oraclePda, kyc: kycPda,
        strike: 1_160_000, expiryOffset: 86400, // 1 day — won't expire
        amount: 10_000_000_000, direction: "quoteToBase",
        premium: 30_000_000,
        userDeposit: userQuote, vaultDeposit: vaultQuoteKp.publicKey,
        vaultPremium: vaultQuoteKp.publicKey, userPremium: userQuote,
      });

      const [attPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("attestation"), posPda.toBuffer()], programId,
      );

      try {
        await refreshOracle(oraclePda, 1_155_800);
        await program.methods.settleDci().accounts({
          vault: vaultPda, oracle: oraclePda, position: posPda, attestation: attPda,
          vaultBaseTokenAccount: vaultBaseKp.publicKey,
          vaultQuoteTokenAccount: vaultQuoteKp.publicKey,
          ownerBaseTokenAccount: userBase, ownerQuoteTokenAccount: userQuote,
          positionOwner: wallet.publicKey, cranker: wallet.publicKey,
          systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
        assert.fail("should reject pre-expiry settlement");
      } catch (e: any) {
        assert.equal(e.error?.errorCode?.code, "DCINotExpired");
      }
    });

    it("rejects ridiculously low premium", async function () {
      await mintTo(connection, keypair, quoteMint, userQuote, keypair, 10_000_000_000);
      await refreshOracle(oraclePda, 1_155_800);

      const vaultData: any = await (program.account as any).vault.fetch(vaultPda);
      const nonce = vaultData.nextNonce.toNumber();
      const [posPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("dci"), vaultPda.toBuffer(), wallet.publicKey.toBuffer(),
         new anchor.BN(nonce).toArrayLike(Buffer, "le", 8)], programId,
      );

      try {
        const ts = await getDevnetTime();
        await program.methods.createDci(
          new anchor.BN(1_160_000), new anchor.BN(ts + 86400 * 30),
          new anchor.BN(10_000_000_000),
          { quoteToBase: {} },
          new anchor.BN(1), // 0.000001 USDC — way too low
          Array.from(Buffer.alloc(32, 0xdd)), new anchor.BN(0),
        ).accounts({
          vault: vaultPda, oracle: oraclePda, kycRecord: kycPda, position: posPda,
          userDepositTokenAccount: userQuote,
          vaultDepositTokenAccount: vaultQuoteKp.publicKey,
          vaultPremiumTokenAccount: vaultQuoteKp.publicKey,
          userPremiumTokenAccount: userQuote,
          owner: wallet.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
        assert.fail("should reject low premium");
      } catch (e: any) {
        assert.equal(e.error?.errorCode?.code, "PremiumTooLow");
      }
    });

    it("tracks and decrements exposure on settlement", async function () {
      await mintTo(connection, keypair, quoteMint, userQuote, keypair, 10_000_000_000);
      await refreshOracle(oraclePda, 1_155_800);

      const vaultBefore: any = await (program.account as any).vault.fetch(vaultPda);
      const exposureBefore = vaultBefore.totalQuoteExposure.toNumber();

      const posPda = await createPosition({
        vault: vaultPda, oracle: oraclePda, kyc: kycPda,
        strike: 1_160_000, expiryOffset: 20,
        amount: 10_000_000_000, direction: "quoteToBase",
        premium: 30_000_000,
        userDeposit: userQuote, vaultDeposit: vaultQuoteKp.publicKey,
        vaultPremium: vaultQuoteKp.publicKey, userPremium: userQuote,
      });

      const vaultAfterCreate: any = await (program.account as any).vault.fetch(vaultPda);
      assert.equal(
        vaultAfterCreate.totalQuoteExposure.toNumber(),
        exposureBefore + 10_000_000_000,
        "exposure incremented on create",
      );

      await settlePosition(
        posPda, vaultPda, oraclePda,
        vaultBaseKp.publicKey, vaultQuoteKp.publicKey,
        userBase, userQuote,
        1_155_800,
      );

      const vaultAfterSettle: any = await (program.account as any).vault.fetch(vaultPda);
      assert.equal(
        vaultAfterSettle.totalQuoteExposure.toNumber(),
        exposureBefore,
        "exposure decremented back after settlement",
      );
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 7. Transfer & Rolling Strategy
  // ──────────────────────────────────────────────────────────────

  describe("Transfer & Rolling", function () {
    it("transfers position ownership", async function () {
      await mintTo(connection, keypair, quoteMint, userQuote, keypair, 10_000_000_000);
      await refreshOracle(oraclePda, 1_155_800);

      const posPda = await createPosition({
        vault: vaultPda, oracle: oraclePda, kyc: kycPda,
        strike: 1_160_000, expiryOffset: 86400,
        amount: 10_000_000_000, direction: "quoteToBase",
        premium: 30_000_000,
        userDeposit: userQuote, vaultDeposit: vaultQuoteKp.publicKey,
        vaultPremium: vaultQuoteKp.publicKey, userPremium: userQuote,
      });

      const newOwner = Keypair.generate().publicKey;
      await program.methods.transferPosition().accounts({
        position: posPda, owner: wallet.publicKey, newOwner,
      }).rpc();

      const data: any = await (program.account as any).dciPosition.fetch(posPda);
      assert.equal(data.owner.toBase58(), newOwner.toBase58());
    });

    it("creates and cancels rolling strategy", async function () {
      const [rollingPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("rolling"), vaultPda.toBuffer(), wallet.publicKey.toBuffer()],
        programId,
      );

      await program.methods.createRollingStrategy(
        { quoteToBase: {} },
        new anchor.BN(200),    // 2% offset
        new anchor.BN(604800), // 7 days
        new anchor.BN(10_000_000_000),
      ).accounts({
        strategy: rollingPda, vault: vaultPda,
        owner: wallet.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();

      const data: any = await (program.account as any).rollingStrategy.fetch(rollingPda);
      assert.isTrue(data.active);
      assert.equal(data.strikeOffsetBps.toNumber(), 200);

      await program.methods.cancelRollingStrategy().accounts({
        strategy: rollingPda, owner: wallet.publicKey,
      }).rpc();

      try {
        await (program.account as any).rollingStrategy.fetch(rollingPda);
        assert.fail("strategy should be closed");
      } catch {
        // Account closed — expected
      }
    });
  });
});
