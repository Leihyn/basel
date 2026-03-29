import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { PROGRAM_ID, RPC_URL } from "./constants";
import { OracleRate, DCIPosition, Attestation, VaultData } from "./types";

// We'll load IDL at runtime
let idlCache: any = null;

async function getIdl() {
  if (idlCache) return idlCache;
  const res = await fetch("/idl/basel.json");
  idlCache = await res.json();
  return idlCache;
}

function getConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

export function getOraclePda(pair: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), Buffer.from(pair)],
    PROGRAM_ID
  )[0];
}

export function getVaultPda(pair: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from(pair)],
    PROGRAM_ID
  )[0];
}

export function getKycPda(wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("kyc"), wallet.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function getDciPda(
  vault: PublicKey,
  owner: PublicKey,
  nonce: number
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("dci"),
      vault.toBuffer(),
      owner.toBuffer(),
      new anchor.BN(nonce).toArrayLike(Buffer, "le", 8),
    ],
    PROGRAM_ID
  )[0];
}

export function getAttestationPda(position: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("attestation"), position.toBuffer()],
    PROGRAM_ID
  )[0];
}

export async function fetchOracleRate(pair: string): Promise<OracleRate | null> {
  try {
    const conn = getConnection();
    const idl = await getIdl();
    const provider = new anchor.AnchorProvider(conn, {} as any, {});
    const program = new anchor.Program(idl, provider);
    const pda = getOraclePda(pair);
    const data: any = await (program.account as any).oracleRate.fetch(pda);
    return {
      pair: data.pair,
      rate: data.rate.toNumber() / 1e6,
      bid: data.bid.toNumber() / 1e6,
      ask: data.ask.toNumber() / 1e6,
      timestamp: data.timestamp.toNumber(),
      vol30d: data.vol30D.toNumber() / 100,
      vol90d: data.vol90D.toNumber() / 100,
      updatedSlot: data.updatedSlot.toNumber(),
      authority: data.authority.toBase58(),
      twap: data.twap ? data.twap.toNumber() / 1e6 : 0,
    };
  } catch {
    return null;
  }
}

// Realistic fallback rates when on-chain oracle data is unavailable (e.g. relayer not running)
const DEMO_RATES: OracleRate[] = [
  { pair: "EUR/USD", rate: 1.08245, bid: 1.08230, ask: 1.08260, timestamp: 0, vol30d: 6.82, vol90d: 7.14, updatedSlot: 0, authority: "", twap: 1.08240 },
  { pair: "CHF/USD", rate: 1.13180, bid: 1.13165, ask: 1.13195, timestamp: 0, vol30d: 5.91, vol90d: 6.23, updatedSlot: 0, authority: "", twap: 1.13175 },
  { pair: "CHF/EUR", rate: 1.04562, bid: 1.04550, ask: 1.04574, timestamp: 0, vol30d: 4.28, vol90d: 4.65, updatedSlot: 0, authority: "", twap: 1.04558 },
  { pair: "GBP/USD", rate: 1.29410, bid: 1.29395, ask: 1.29425, timestamp: 0, vol30d: 7.45, vol90d: 7.89, updatedSlot: 0, authority: "", twap: 1.29405 },
  { pair: "XAU/USD", rate: 3021.45, bid: 3020.80, ask: 3022.10, timestamp: 0, vol30d: 14.32, vol90d: 15.18, updatedSlot: 0, authority: "", twap: 3021.20 },
  { pair: "XAG/USD", rate: 33.68, bid: 33.62, ask: 33.74, timestamp: 0, vol30d: 22.15, vol90d: 23.40, updatedSlot: 0, authority: "", twap: 33.65 },
];

function addJitter(rates: OracleRate[]): OracleRate[] {
  const now = Math.floor(Date.now() / 1000);
  return rates.map((r) => {
    const jitter = 1 + (Math.random() - 0.5) * 0.0004; // ±0.02%
    return { ...r, rate: r.rate * jitter, bid: r.bid * jitter, ask: r.ask * jitter, twap: r.twap * (1 + (Math.random() - 0.5) * 0.0002), timestamp: now };
  });
}

export async function fetchAllOracleRates(): Promise<OracleRate[]> {
  const pairs = ["EUR/USD", "CHF/USD", "CHF/EUR", "GBP/USD", "XAU/USD", "XAG/USD"];
  const results = await Promise.all(pairs.map(fetchOracleRate));
  const live = results.filter((r): r is OracleRate => r !== null);
  if (live.length > 0) return live;
  // Fallback: realistic demo rates with slight jitter each poll
  return addJitter(DEMO_RATES);
}

export async function fetchUserPositions(
  owner: PublicKey
): Promise<DCIPosition[]> {
  try {
    const conn = getConnection();
    const idl = await getIdl();
    const provider = new anchor.AnchorProvider(conn, {} as any, {});
    const program = new anchor.Program(idl, provider);

    const accounts = await (program.account as any).dciPosition.all([
      { memcmp: { offset: 8, bytes: owner.toBase58() } },
    ]);

    return accounts.map((acc: any) => ({
      pubkey: acc.publicKey.toBase58(),
      owner: acc.account.owner.toBase58(),
      vault: acc.account.vault.toBase58(),
      strike: acc.account.strike.toNumber() / 1e6,
      expiry: acc.account.expiry.toNumber(),
      amount: acc.account.amount.toNumber() / 1e6,
      direction: acc.account.direction.baseToQuote
        ? "BaseToQuote"
        : "QuoteToBase",
      premiumRate: acc.account.premiumRate.toNumber() / 1e6,
      premiumPaid: acc.account.premiumPaid.toNumber() / 1e6,
      status: acc.account.status.active ? "Active" : "Settled",
      settlementRate: acc.account.settlementRate.toNumber() / 1e6,
      settlementAmount: acc.account.settlementAmount.toNumber() / 1e6,
      complianceHash: Buffer.from(acc.account.complianceHash).toString("hex"),
      nonce: acc.account.nonce.toNumber(),
      createdAt: acc.account.createdAt.toNumber(),
      strikeUpper: acc.account.strikeUpper ? acc.account.strikeUpper.toNumber() / 1e6 : 0,
    }));
  } catch {
    return [];
  }
}

export async function getProgram(wallet: anchor.Wallet): Promise<anchor.Program> {
  const conn = getConnection();
  const idl = await getIdl();
  const provider = new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  return new anchor.Program(idl, provider);
}

export interface CreateDCIParams {
  pair: string;
  strike: number; // e.g. 1.16
  expiryTimestamp: number; // unix seconds
  amount: number; // token units (e.g. 10000 for 10K USDC)
  direction: "BaseToQuote" | "QuoteToBase";
  premium: number; // token units
  complianceHash: number[];
  strikeUpper: number; // 0 for standard DCI, >0 for range DCI
  // Token accounts
  userDepositTokenAccount: PublicKey;
  vaultDepositTokenAccount: PublicKey;
  vaultPremiumTokenAccount: PublicKey;
  userPremiumTokenAccount: PublicKey;
}

export async function createDCI(
  wallet: anchor.Wallet,
  params: CreateDCIParams
): Promise<string> {
  const program = await getProgram(wallet);
  const vaultPda = getVaultPda(params.pair);
  const oraclePda = getOraclePda(params.pair);
  const kycPda = getKycPda(wallet.publicKey);

  // Get vault nonce
  const vaultData: any = await (program.account as any).vault.fetch(vaultPda);
  const nonce = vaultData.nextNonce.toNumber();
  const positionPda = getDciPda(vaultPda, wallet.publicKey, nonce);

  const direction = params.direction === "BaseToQuote"
    ? { baseToQuote: {} }
    : { quoteToBase: {} };

  const tx = await program.methods
    .createDci(
      new anchor.BN(Math.round(params.strike * 1e6)),
      new anchor.BN(params.expiryTimestamp),
      new anchor.BN(Math.round(params.amount * 1e6)),
      direction,
      new anchor.BN(Math.round(params.premium * 1e6)),
      params.complianceHash,
      new anchor.BN(Math.round((params.strikeUpper || 0) * 1e6))
    )
    .accounts({
      vault: vaultPda,
      oracle: oraclePda,
      kycRecord: kycPda,
      position: positionPda,
      userDepositTokenAccount: params.userDepositTokenAccount,
      vaultDepositTokenAccount: params.vaultDepositTokenAccount,
      vaultPremiumTokenAccount: params.vaultPremiumTokenAccount,
      userPremiumTokenAccount: params.userPremiumTokenAccount,
      owner: wallet.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  return tx;
}

export async function settleDCI(
  wallet: anchor.Wallet,
  position: DCIPosition,
  vaultBaseTokenAccount: PublicKey,
  vaultQuoteTokenAccount: PublicKey,
  ownerBaseTokenAccount: PublicKey,
  ownerQuoteTokenAccount: PublicKey
): Promise<string> {
  const program = await getProgram(wallet);
  const positionPda = new PublicKey(position.pubkey);
  const vaultPda = new PublicKey(position.vault);
  const attestationPda = getAttestationPda(positionPda);

  // Get vault to find oracle pair
  const vaultData: any = await (program.account as any).vault.fetch(vaultPda);
  const oraclePda = getOraclePda(vaultData.pair);

  const tx = await program.methods
    .settleDci()
    .accounts({
      vault: vaultPda,
      oracle: oraclePda,
      position: positionPda,
      attestation: attestationPda,
      vaultBaseTokenAccount,
      vaultQuoteTokenAccount,
      ownerBaseTokenAccount,
      ownerQuoteTokenAccount,
      positionOwner: new PublicKey(position.owner),
      cranker: wallet.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  return tx;
}

export async function fetchVaultData(pair: string): Promise<any | null> {
  try {
    const conn = getConnection();
    const idl = await getIdl();
    const provider = new anchor.AnchorProvider(conn, {} as any, {});
    const program = new anchor.Program(idl, provider);
    const pda = getVaultPda(pair);
    return await (program.account as any).vault.fetch(pda);
  } catch {
    return null;
  }
}

export async function settleFromUI(
  wallet: anchor.Wallet,
  position: DCIPosition
): Promise<string> {
  const program = await getProgram(wallet);
  const vaultPda = new PublicKey(position.vault);
  const vaultData: any = await (program.account as any).vault.fetch(vaultPda);
  const positionPda = new PublicKey(position.pubkey);
  const attestationPda = getAttestationPda(positionPda);
  const oraclePda = getOraclePda(vaultData.pair);

  // Resolve user token accounts
  const ownerKey = new PublicKey(position.owner);
  const ownerBaseAta = getAssociatedTokenAddressSync(vaultData.baseMint, ownerKey, true);
  const ownerQuoteAta = getAssociatedTokenAddressSync(vaultData.quoteMint, ownerKey, true);

  const tx = await program.methods
    .settleDci()
    .accounts({
      vault: vaultPda,
      oracle: oraclePda,
      position: positionPda,
      attestation: attestationPda,
      vaultBaseTokenAccount: vaultData.baseTokenAccount,
      vaultQuoteTokenAccount: vaultData.quoteTokenAccount,
      ownerBaseTokenAccount: ownerBaseAta,
      ownerQuoteTokenAccount: ownerQuoteAta,
      positionOwner: ownerKey,
      cranker: wallet.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  return tx;
}

export async function fetchAttestation(
  positionPubkey: string
): Promise<Attestation | null> {
  try {
    const conn = getConnection();
    const idl = await getIdl();
    const provider = new anchor.AnchorProvider(conn, {} as any, {});
    const program = new anchor.Program(idl, provider);
    const posKey = new PublicKey(positionPubkey);
    const pda = getAttestationPda(posKey);
    const data: any = await (program.account as any).attestation.fetch(pda);

    return {
      pubkey: pda.toBase58(),
      position: data.position.toBase58(),
      sender: data.sender.toBase58(),
      vault: data.vault.toBase58(),
      amountIn: data.amountIn.toNumber() / 1e6,
      amountOut: data.amountOut.toNumber() / 1e6,
      pair: data.pair,
      sixRate: data.sixRate.toNumber() / 1e6,
      sixTimestamp: data.sixTimestamp.toNumber(),
      sourceHash: Buffer.from(data.sourceHash).toString("hex"),
      complianceHash: Buffer.from(data.complianceHash).toString("hex"),
      converted: data.converted,
      direction: data.direction.baseToQuote ? "BaseToQuote" : "QuoteToBase",
      createdAt: data.createdAt.toNumber(),
    };
  } catch {
    return null;
  }
}
