use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{Vault, DCIPosition, DCIDirection, DCIStatus, KYCRecord, OracleRate, SettlementMode};
use crate::errors::BaselError;

#[derive(Accounts)]
pub struct CreateDCI<'info> {
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
        seeds = [b"kyc", owner.key().as_ref()],
        bump = kyc_record.bump,
    )]
    pub kyc_record: Box<Account<'info, KYCRecord>>,

    #[account(
        init,
        payer = owner,
        space = DCIPosition::SIZE,
        seeds = [b"dci", vault.key().as_ref(), owner.key().as_ref(), vault.next_nonce.to_le_bytes().as_ref()],
        bump,
    )]
    pub position: Box<Account<'info, DCIPosition>>,

    #[account(mut)]
    pub user_deposit_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault_deposit_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub vault_premium_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub user_premium_token_account: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<CreateDCI>,
    strike: u64,
    expiry: i64,
    amount: u64,
    direction: DCIDirection,
    premium: u64,
    compliance_hash: [u8; 32],
    strike_upper: u64,
) -> Result<()> {
    let clock = Clock::get()?;

    // Validate inputs
    require!(strike > 0, BaselError::InvalidStrike);
    require!(expiry > clock.unix_timestamp, BaselError::InvalidExpiry);
    require!(premium > 0, BaselError::InvalidPremium);

    // Range DCI validation
    if strike_upper > 0 {
        require!(strike_upper > strike, BaselError::InvalidStrikeUpper);
    }

    // KYC check
    let kyc = &ctx.accounts.kyc_record;
    require!(kyc.kyc_level >= 1, BaselError::KYCNotApproved);
    require!(kyc.expires_at > clock.unix_timestamp, BaselError::KYCExpired);

    // Oracle staleness check (24 hours)
    let oracle = &ctx.accounts.oracle;
    require!(
        clock.unix_timestamp - oracle.timestamp <= 86_400,
        BaselError::OracleStale
    );

    let vault = &mut ctx.accounts.vault;

    // Cash-settled vaults only allow QuoteToBase
    if vault.settlement_mode == SettlementMode::CashSettled {
        require!(direction == DCIDirection::QuoteToBase, BaselError::CashSettlementOnly);
    }

    // Minimum premium check based on volatility, scaled by tenor
    // min_premium = amount * vol_30d * (tenor_days / 7) / 10_000_000
    // tenor_days / 7 normalizes to a 7-day baseline
    let tenor_seconds = expiry - clock.unix_timestamp;
    if oracle.vol_30d > 0 && tenor_seconds > 0 {
        let tenor_days_x100 = (tenor_seconds as u64)
            .checked_mul(100)
            .unwrap_or(0)
            .checked_div(86400)
            .unwrap_or(1)
            .max(1); // min 1 (0.01 days)
        // Scale by tenor: longer tenor = higher minimum
        let min_premium = amount
            .checked_mul(oracle.vol_30d)
            .unwrap_or(0)
            .checked_mul(tenor_days_x100)
            .unwrap_or(0)
            .checked_div(7_000_000_000) // 10M * 100 * 7 (7-day normalization)
            .unwrap_or(0);
        if min_premium > 0 {
            require!(premium >= min_premium, BaselError::PremiumTooLow);
        }
    }

    // Validate token accounts match direction
    match direction {
        DCIDirection::BaseToQuote => {
            require!(
                ctx.accounts.vault_deposit_token_account.key() == vault.base_token_account,
                BaselError::InvalidSide
            );
        }
        DCIDirection::QuoteToBase => {
            require!(
                ctx.accounts.vault_deposit_token_account.key() == vault.quote_token_account,
                BaselError::InvalidSide
            );
        }
    }

    // Transfer deposit from user to vault
    let deposit_cpi = Transfer {
        from: ctx.accounts.user_deposit_token_account.to_account_info(),
        to: ctx.accounts.vault_deposit_token_account.to_account_info(),
        authority: ctx.accounts.owner.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), deposit_cpi),
        amount,
    )?;

    // Pay premium from vault to user
    let pair_bytes = vault.pair.as_bytes().to_vec();
    let bump = vault.bump;
    let seeds: &[&[u8]] = &[b"vault", &pair_bytes, &[bump]];
    let signer_seeds = &[seeds];

    let premium_cpi = Transfer {
        from: ctx.accounts.vault_premium_token_account.to_account_info(),
        to: ctx.accounts.user_premium_token_account.to_account_info(),
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
    match direction {
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

    // Create position
    let nonce = vault.next_nonce;
    vault.next_nonce = nonce.checked_add(1).ok_or(BaselError::MathOverflow)?;

    let position = &mut ctx.accounts.position;
    position.owner = ctx.accounts.owner.key();
    position.vault = vault.key();
    position.strike = strike;
    position.expiry = expiry;
    position.amount = amount;
    position.direction = direction;
    position.premium_rate = premium
        .checked_mul(1_000_000)
        .ok_or(BaselError::MathOverflow)?
        .checked_div(amount)
        .ok_or(BaselError::MathOverflow)?;
    position.premium_paid = premium;
    position.status = DCIStatus::Active;
    position.settlement_rate = 0;
    position.settlement_amount = 0;
    position.compliance_hash = compliance_hash;
    position.nonce = nonce;
    position.created_at = clock.unix_timestamp;
    position.bump = ctx.bumps.position;
    position.strike_upper = strike_upper;

    msg!(
        "DCI created: pair={} strike={} strike_upper={} amount={} premium={}",
        vault.pair, strike, strike_upper, amount, premium
    );
    Ok(())
}
