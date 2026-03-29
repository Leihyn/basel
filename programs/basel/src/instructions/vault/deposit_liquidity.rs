use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::Vault;
use crate::errors::BaselError;

#[derive(Accounts)]
#[instruction(amount: u64, side: u8)]
pub struct DepositLiquidity<'info> {
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
        constraint = depositor_token_account.owner == authority.key(),
    )]
    pub depositor_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<DepositLiquidity>, amount: u64, _side: u8) -> Result<()> {
    // Transfer tokens from depositor to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.depositor_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    token::transfer(CpiContext::new(cpi_program, cpi_accounts), amount)?;

    msg!("Deposited {} to vault {}", amount, ctx.accounts.vault.pair);
    Ok(())
}
