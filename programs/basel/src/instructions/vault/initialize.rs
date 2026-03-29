use anchor_lang::prelude::*;
use anchor_spl::token::{Token, Mint, TokenAccount};
use crate::state::{Vault, SettlementMode};
use crate::errors::BaselError;

#[derive(Accounts)]
#[instruction(pair: String)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = authority,
        space = Vault::SIZE,
        seeds = [b"vault", pair.as_bytes()],
        bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    pub base_mint: Account<'info, Mint>,
    pub quote_mint: Account<'info, Mint>,

    /// Pre-created base token account owned by vault PDA
    #[account(
        token::mint = base_mint,
        token::authority = vault,
    )]
    pub base_token_account: Account<'info, TokenAccount>,

    /// Pre-created quote token account owned by vault PDA
    #[account(
        token::mint = quote_mint,
        token::authority = vault,
    )]
    pub quote_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<InitializeVault>, pair: String, settlement_mode: u8) -> Result<()> {
    require!(pair.len() <= 16, BaselError::PairTooLong);

    let mode = if settlement_mode == 1 {
        SettlementMode::CashSettled
    } else {
        SettlementMode::Physical
    };

    let vault = &mut ctx.accounts.vault;
    vault.pair = pair;
    vault.base_mint = ctx.accounts.base_mint.key();
    vault.quote_mint = ctx.accounts.quote_mint.key();
    vault.base_token_account = ctx.accounts.base_token_account.key();
    vault.quote_token_account = ctx.accounts.quote_token_account.key();
    vault.authority = ctx.accounts.authority.key();
    vault.next_nonce = 0;
    vault.bump = ctx.bumps.vault;
    vault.total_base_exposure = 0;
    vault.total_quote_exposure = 0;
    vault.settlement_mode = mode;

    msg!("Vault initialized for pair: {} mode={}", vault.pair, settlement_mode);
    Ok(())
}
