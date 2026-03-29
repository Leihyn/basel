use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::DCIDirection;

declare_id!("BQ1s2KUnoNTbK26JwNpg8L2Kh6LMnFXU45ydM7er8e6x");

#[program]
pub mod basel {
    use super::*;

    // ── Oracle ──────────────────────────────────────────────

    pub fn initialize_oracle(ctx: Context<InitializeOracle>, pair: String) -> Result<()> {
        oracle::initialize::handler(ctx, pair)
    }

    pub fn update_rate(
        ctx: Context<UpdateRate>,
        rate: u64,
        bid: u64,
        ask: u64,
        timestamp: i64,
        source_hash: [u8; 32],
        vol_30d: u64,
        vol_90d: u64,
    ) -> Result<()> {
        oracle::update_rate::handler(ctx, rate, bid, ask, timestamp, source_hash, vol_30d, vol_90d)
    }

    // ── KYC ─────────────────────────────────────────────────

    pub fn approve_wallet(
        ctx: Context<ApproveWallet>,
        wallet: Pubkey,
        kyc_level: u8,
        expires_at: i64,
        compliance_hash: [u8; 32],
    ) -> Result<()> {
        kyc::approve::handler(ctx, wallet, kyc_level, expires_at, compliance_hash)
    }

    pub fn revoke_wallet(ctx: Context<RevokeWallet>) -> Result<()> {
        kyc::revoke::handler(ctx)
    }

    // ── Vault ───────────────────────────────────────────────

    pub fn initialize_vault(ctx: Context<InitializeVault>, pair: String, settlement_mode: u8) -> Result<()> {
        vault::initialize::handler(ctx, pair, settlement_mode)
    }

    pub fn deposit_liquidity(
        ctx: Context<DepositLiquidity>,
        amount: u64,
        side: u8,
    ) -> Result<()> {
        vault::deposit_liquidity::handler(ctx, amount, side)
    }

    pub fn withdraw_liquidity(
        ctx: Context<WithdrawLiquidity>,
        amount: u64,
        side: u8,
    ) -> Result<()> {
        vault::withdraw_liquidity::handler(ctx, amount, side)
    }

    // ── DCI ─────────────────────────────────────────────────

    pub fn create_dci(
        ctx: Context<CreateDCI>,
        strike: u64,
        expiry: i64,
        amount: u64,
        direction: DCIDirection,
        premium: u64,
        compliance_hash: [u8; 32],
        strike_upper: u64,
    ) -> Result<()> {
        dci::create::handler(ctx, strike, expiry, amount, direction, premium, compliance_hash, strike_upper)
    }

    pub fn settle_dci(ctx: Context<SettleDCI>) -> Result<()> {
        dci::settle::handler(ctx)
    }

    pub fn transfer_position(ctx: Context<TransferPosition>) -> Result<()> {
        dci::transfer::handler(ctx)
    }

    // ── Rolling Strategy ────────────────────────────────────

    pub fn create_rolling_strategy(
        ctx: Context<CreateRollingStrategy>,
        direction: DCIDirection,
        strike_offset_bps: u64,
        tenor_seconds: i64,
        amount: u64,
    ) -> Result<()> {
        dci::rolling::handler_create(ctx, direction, strike_offset_bps, tenor_seconds, amount)
    }

    pub fn cancel_rolling_strategy(ctx: Context<CancelRollingStrategy>) -> Result<()> {
        dci::rolling::handler_cancel(ctx)
    }

    pub fn execute_roll(ctx: Context<ExecuteRoll>) -> Result<()> {
        dci::roll_execute::handler(ctx)
    }
}
