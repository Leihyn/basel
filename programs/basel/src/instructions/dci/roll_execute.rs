use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{
    Vault, DCIPosition, DCIDirection, DCIStatus, OracleRate, Attestation,
    RollingStrategy, KYCRecord, SettlementMode,
};
use crate::errors::BaselError;

#[derive(Accounts)]
pub struct ExecuteRoll<'info> {
    #[account(
        mut,
        constraint = strategy.active @ BaselError::RollingStrategyInactive,
        constraint = strategy.vault == vault.key(),
    )]
    pub strategy: Box<Account<'info, RollingStrategy>>,

    #[account(
        mut,
        seeds = [b"vault", vault.pair.as_bytes()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        seeds = [b"oracle", vault.pair.as_bytes()],
        bump = oracle.bump,
    )]
    pub oracle: Box<Account<'info, OracleRate>>,

    #[account(
        seeds = [b"kyc", strategy.owner.as_ref()],
        bump = kyc_record.bump,
    )]
    pub kyc_record: Box<Account<'info, KYCRecord>>,

    /// The old (settled) position to roll from
    #[account(
        mut,
        constraint = old_position.vault == vault.key(),
        constraint = old_position.owner == strategy.owner,
        constraint = old_position.status == DCIStatus::Settled @ BaselError::RollingPositionNotSettled,
    )]
    pub old_position: Box<Account<'info, DCIPosition>>,

    /// New position PDA to create
    #[account(
        init,
        payer = cranker,
        space = DCIPosition::SIZE,
        seeds = [b"dci", vault.key().as_ref(), strategy.owner.as_ref(), vault.next_nonce.to_le_bytes().as_ref()],
        bump,
    )]
    pub new_position: Box<Account<'info, DCIPosition>>,

    // Token accounts for premium payment
    #[account(mut, constraint = vault_token_account.key() == if strategy.direction == DCIDirection::QuoteToBase { vault.quote_token_account } else { vault.base_token_account })]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub user_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub cranker: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ExecuteRoll>) -> Result<()> {
    let clock = Clock::get()?;
    let strategy = &ctx.accounts.strategy;
    let oracle = &ctx.accounts.oracle;
    let vault = &mut ctx.accounts.vault;

    // Verify KYC still valid
    let kyc = &ctx.accounts.kyc_record;
    require!(kyc.kyc_level >= 1, BaselError::KYCNotApproved);
    require!(kyc.expires_at > clock.unix_timestamp, BaselError::KYCExpired);

    // Oracle staleness check
    require!(
        clock.unix_timestamp - oracle.timestamp <= 120,
        BaselError::OracleStale
    );

    // Compute new strike from oracle rate + offset
    let spot = oracle.rate;
    let offset = strategy.strike_offset_bps;
    let new_strike = match strategy.direction {
        DCIDirection::QuoteToBase => {
            // Strike above spot
            spot.checked_mul(10000 + offset)
                .ok_or(BaselError::MathOverflow)?
                .checked_div(10000)
                .ok_or(BaselError::MathOverflow)?
        }
        DCIDirection::BaseToQuote => {
            // Strike below spot
            spot.checked_mul(10000_u64.saturating_sub(offset))
                .ok_or(BaselError::MathOverflow)?
                .checked_div(10000)
                .ok_or(BaselError::MathOverflow)?
        }
    };

    let new_expiry = clock.unix_timestamp + strategy.tenor_seconds;
    let amount = strategy.amount;

    // Compute premium from vol (simplified)
    let premium = if oracle.vol_30d > 0 {
        let tenor_days_x100 = (strategy.tenor_seconds as u64)
            .checked_mul(100)
            .unwrap_or(700)
            .checked_div(86400)
            .unwrap_or(1)
            .max(1);
        // premium = amount * vol * tenor_factor * 0.4 / scale
        amount
            .checked_mul(oracle.vol_30d)
            .unwrap_or(0)
            .checked_mul(tenor_days_x100)
            .unwrap_or(0)
            .checked_mul(4)
            .unwrap_or(0)
            .checked_div(3_650_000_000) // 10000 * 100 * 365 * 10 (scaling)
            .unwrap_or(0)
            .max(1) // at least 1 lamport
    } else {
        1 // minimum premium
    };

    // Pay premium from vault to user (vault PDA signs)
    let pair_bytes = vault.pair.as_bytes().to_vec();
    let bump = vault.bump;
    let seeds: &[&[u8]] = &[b"vault", &pair_bytes, &[bump]];
    let signer_seeds = &[seeds];

    let premium_cpi = Transfer {
        from: ctx.accounts.vault_token_account.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: vault.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            premium_cpi,
            signer_seeds,
        ),
        premium,
    )?;

    // Track exposure
    match strategy.direction {
        DCIDirection::BaseToQuote => {
            vault.total_base_exposure = vault.total_base_exposure
                .checked_add(amount)
                .ok_or(BaselError::MathOverflow)?;
        }
        DCIDirection::QuoteToBase => {
            vault.total_quote_exposure = vault.total_quote_exposure
                .checked_add(amount)
                .ok_or(BaselError::MathOverflow)?;
        }
    }

    // Create new position
    let nonce = vault.next_nonce;
    vault.next_nonce = nonce.checked_add(1).ok_or(BaselError::MathOverflow)?;

    let new_pos = &mut ctx.accounts.new_position;
    new_pos.owner = strategy.owner;
    new_pos.vault = vault.key();
    new_pos.strike = new_strike;
    new_pos.expiry = new_expiry;
    new_pos.amount = amount;
    new_pos.direction = strategy.direction;
    new_pos.premium_rate = premium
        .checked_mul(1_000_000)
        .ok_or(BaselError::MathOverflow)?
        .checked_div(amount)
        .ok_or(BaselError::MathOverflow)?;
    new_pos.premium_paid = premium;
    new_pos.status = DCIStatus::Active;
    new_pos.settlement_rate = 0;
    new_pos.settlement_amount = 0;
    new_pos.compliance_hash = [0u8; 32]; // Inherited from strategy context
    new_pos.nonce = nonce;
    new_pos.created_at = clock.unix_timestamp;
    new_pos.bump = ctx.bumps.new_position;
    new_pos.strike_upper = 0; // Standard DCI for rolls

    // Update strategy
    let strategy = &mut ctx.accounts.strategy;
    strategy.current_position = new_pos.key();
    strategy.last_roll_at = clock.unix_timestamp;

    msg!(
        "Roll executed: pair={} strike={} expiry={} amount={} premium={}",
        vault.pair, new_strike, new_expiry, amount, premium
    );
    Ok(())
}
