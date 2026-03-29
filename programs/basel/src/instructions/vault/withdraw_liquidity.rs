use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::Vault;
use crate::errors::BaselError;

#[derive(Accounts)]
#[instruction(amount: u64, side: u8)]
pub struct WithdrawLiquidity<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault.pair.as_bytes()],
        bump = vault.bump,
        has_one = authority @ BaselError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        constraint = vault_token_account.key() == if side == 0 { vault.base_token_account } else { vault.quote_token_account }
            @ BaselError::InvalidSide,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = recipient_token_account.owner == authority.key(),
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawLiquidity>, amount: u64, side: u8) -> Result<()> {
    let vault = &ctx.accounts.vault;

    // Withdrawal guard: can't withdraw more than available (balance - exposure)
    let exposure = if side == 0 { vault.total_base_exposure } else { vault.total_quote_exposure };
    let balance = ctx.accounts.vault_token_account.amount;
    let available = balance.saturating_sub(exposure);
    require!(amount <= available, BaselError::VaultInsufficientLiquidity);

    let pair_bytes = vault.pair.as_bytes();
    let bump = vault.bump;
    let seeds: &[&[u8]] = &[b"vault", pair_bytes, &[bump]];
    let signer_seeds = &[seeds];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault_token_account.to_account_info(),
        to: ctx.accounts.recipient_token_account.to_account_info(),
        authority: ctx.accounts.vault.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    token::transfer(
        CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds),
        amount,
    )?;

    msg!("Withdrew {} from vault {}", amount, vault.pair);
    Ok(())
}
