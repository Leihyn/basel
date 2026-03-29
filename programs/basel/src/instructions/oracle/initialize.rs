use anchor_lang::prelude::*;
use crate::state::{OracleRate, OracleObservation};
use crate::errors::BaselError;

#[derive(Accounts)]
#[instruction(pair: String)]
pub struct InitializeOracle<'info> {
    #[account(
        init,
        payer = authority,
        space = OracleRate::SIZE,
        seeds = [b"oracle", pair.as_bytes()],
        bump,
    )]
    pub oracle: Box<Account<'info, OracleRate>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeOracle>, pair: String) -> Result<()> {
    require!(pair.len() <= 16, BaselError::PairTooLong);

    let oracle = &mut ctx.accounts.oracle;
    oracle.pair = pair;
    oracle.rate = 0;
    oracle.bid = 0;
    oracle.ask = 0;
    oracle.timestamp = 0;
    oracle.source_hash = [0u8; 32];
    oracle.vol_30d = 0;
    oracle.vol_90d = 0;
    oracle.updated_slot = 0;
    oracle.authority = ctx.accounts.authority.key();
    oracle.bump = ctx.bumps.oracle;
    // TWAP init
    oracle.observations = [OracleObservation::default(); 6];
    oracle.obs_index = 0;
    oracle.obs_count = 0;
    oracle.twap = 0;

    msg!("Oracle initialized for pair: {}", oracle.pair);
    Ok(())
}
