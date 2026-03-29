use anchor_lang::prelude::*;
use crate::state::{Vault, RollingStrategy, DCIDirection};

#[derive(Accounts)]
pub struct CreateRollingStrategy<'info> {
    #[account(
        init,
        payer = owner,
        space = RollingStrategy::SIZE,
        seeds = [b"rolling", vault.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub strategy: Box<Account<'info, RollingStrategy>>,

    #[account(
        seeds = [b"vault", vault.pair.as_bytes()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler_create(
    ctx: Context<CreateRollingStrategy>,
    direction: DCIDirection,
    strike_offset_bps: u64,
    tenor_seconds: i64,
    amount: u64,
) -> Result<()> {
    let strategy = &mut ctx.accounts.strategy;
    strategy.owner = ctx.accounts.owner.key();
    strategy.vault = ctx.accounts.vault.key();
    strategy.direction = direction;
    strategy.strike_offset_bps = strike_offset_bps;
    strategy.tenor_seconds = tenor_seconds;
    strategy.amount = amount;
    strategy.active = true;
    strategy.current_position = Pubkey::default();
    strategy.last_roll_at = Clock::get()?.unix_timestamp;
    strategy.bump = ctx.bumps.strategy;

    msg!("Rolling strategy created: offset={}bps tenor={}s", strike_offset_bps, tenor_seconds);
    Ok(())
}

#[derive(Accounts)]
pub struct CancelRollingStrategy<'info> {
    #[account(
        mut,
        close = owner,
        constraint = strategy.owner == owner.key(),
    )]
    pub strategy: Box<Account<'info, RollingStrategy>>,

    #[account(mut)]
    pub owner: Signer<'info>,
}

pub fn handler_cancel(ctx: Context<CancelRollingStrategy>) -> Result<()> {
    msg!("Rolling strategy cancelled for {}", ctx.accounts.strategy.owner);
    Ok(())
}
