use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::{Vault, DCIPosition, DCIDirection, DCIStatus, OracleRate, Attestation, SettlementMode};
use crate::errors::BaselError;

#[derive(Accounts)]
pub struct SettleDCI<'info> {
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
        mut,
        seeds = [b"dci", position.vault.as_ref(), position.owner.as_ref(), position.nonce.to_le_bytes().as_ref()],
        bump = position.bump,
        constraint = position.vault == vault.key(),
        constraint = position.status == DCIStatus::Active @ BaselError::DCIAlreadySettled,
    )]
    pub position: Box<Account<'info, DCIPosition>>,

    #[account(
        init,
        payer = cranker,
        space = Attestation::SIZE,
        seeds = [b"attestation", position.key().as_ref()],
        bump,
    )]
    pub attestation: Box<Account<'info, Attestation>>,

    #[account(mut, constraint = vault_base_token_account.key() == vault.base_token_account)]
    pub vault_base_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = vault_quote_token_account.key() == vault.quote_token_account)]
    pub vault_quote_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub owner_base_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub owner_quote_token_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: Position owner, validated via position.owner
    pub position_owner: AccountInfo<'info>,

    #[account(mut)]
    pub cranker: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<SettleDCI>) -> Result<()> {
    let clock = Clock::get()?;
    let position = &ctx.accounts.position;

    require!(
        clock.unix_timestamp >= position.expiry,
        BaselError::DCINotExpired
    );

    let oracle = &ctx.accounts.oracle;
    // Oracle staleness check (5 minutes for settlement)
    require!(
        clock.unix_timestamp - oracle.timestamp <= 300,
        BaselError::OracleStale
    );
    // Use TWAP if available, fallback to spot rate
    let settlement_rate = if oracle.twap > 0 { oracle.twap } else { oracle.rate };
    let strike = position.strike;
    let strike_upper = position.strike_upper;
    let amount = position.amount;
    let vault = &ctx.accounts.vault;
    let is_cash_settled = vault.settlement_mode == SettlementMode::CashSettled;
    let is_range = strike_upper > 0;

    // Determine settlement outcome
    let (converted, amount_out, from_account, to_account) = match position.direction {
        DCIDirection::BaseToQuote => {
            let should_convert = if is_range {
                // Range: convert only if rate >= upper strike (breaks out above)
                settlement_rate >= strike_upper
            } else {
                settlement_rate >= strike
            };

            if should_convert {
                // Use u128 to avoid overflow with large prices (e.g. gold)
                let out = (amount as u128)
                    .checked_mul(strike as u128)
                    .ok_or(BaselError::MathOverflow)?
                    .checked_div(1_000_000)
                    .ok_or(BaselError::MathOverflow)? as u64;
                (
                    true, out,
                    ctx.accounts.vault_quote_token_account.to_account_info(),
                    ctx.accounts.owner_quote_token_account.to_account_info(),
                )
            } else {
                (
                    false, amount,
                    ctx.accounts.vault_base_token_account.to_account_info(),
                    ctx.accounts.owner_base_token_account.to_account_info(),
                )
            }
        }
        DCIDirection::QuoteToBase => {
            let should_convert = if is_range {
                // Range: convert only if rate <= lower strike (breaks out below)
                settlement_rate <= strike
            } else {
                settlement_rate < strike
            };

            if should_convert {
                if is_cash_settled {
                    // Cash settlement: return quote tokens at reduced value
                    // amount_out = amount * settlement_rate / strike (use u128 to avoid overflow)
                    let out = (amount as u128)
                        .checked_mul(settlement_rate as u128)
                        .ok_or(BaselError::MathOverflow)?
                        .checked_div(strike as u128)
                        .ok_or(BaselError::MathOverflow)? as u64;
                    (
                        true, out,
                        ctx.accounts.vault_quote_token_account.to_account_info(),
                        ctx.accounts.owner_quote_token_account.to_account_info(),
                    )
                } else {
                    // Physical settlement: convert to base tokens (u128 for large prices)
                    let out = (amount as u128)
                        .checked_mul(1_000_000)
                        .ok_or(BaselError::MathOverflow)?
                        .checked_div(strike as u128)
                        .ok_or(BaselError::MathOverflow)? as u64;
                    (
                        true, out,
                        ctx.accounts.vault_base_token_account.to_account_info(),
                        ctx.accounts.owner_base_token_account.to_account_info(),
                    )
                }
            } else {
                (
                    false, amount,
                    ctx.accounts.vault_quote_token_account.to_account_info(),
                    ctx.accounts.owner_quote_token_account.to_account_info(),
                )
            }
        }
    };

    // Transfer tokens from vault to owner
    let vault = &ctx.accounts.vault;
    let pair_bytes = vault.pair.as_bytes().to_vec();
    let bump = vault.bump;
    let seeds: &[&[u8]] = &[b"vault", &pair_bytes, &[bump]];
    let signer_seeds = &[seeds];

    let cpi_accounts = Transfer {
        from: from_account,
        to: to_account,
        authority: vault.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        ),
        amount_out,
    )?;

    // Decrement exposure
    let vault = &mut ctx.accounts.vault;
    match position.direction {
        DCIDirection::BaseToQuote => {
            vault.total_base_exposure = vault.total_base_exposure.saturating_sub(amount);
        }
        DCIDirection::QuoteToBase => {
            vault.total_quote_exposure = vault.total_quote_exposure.saturating_sub(amount);
        }
    }

    // Update position
    let position = &mut ctx.accounts.position;
    position.status = DCIStatus::Settled;
    position.settlement_rate = settlement_rate;
    position.settlement_amount = amount_out;

    // Create attestation
    let attestation = &mut ctx.accounts.attestation;
    attestation.position = position.key();
    attestation.sender = position.owner;
    attestation.vault = vault.key();
    attestation.amount_in = amount;
    attestation.amount_out = amount_out;
    attestation.pair = vault.pair.clone();
    attestation.six_rate = settlement_rate;
    attestation.six_timestamp = oracle.timestamp;
    attestation.source_hash = oracle.source_hash;
    attestation.compliance_hash = position.compliance_hash;
    attestation.converted = converted;
    attestation.direction = position.direction;
    attestation.created_at = clock.unix_timestamp;
    attestation.bump = ctx.bumps.attestation;

    msg!(
        "DCI settled: pair={} strike={} twap={} converted={} amount_out={} cash_settled={}",
        vault.pair, strike, settlement_rate, converted, amount_out, is_cash_settled
    );
    Ok(())
}
