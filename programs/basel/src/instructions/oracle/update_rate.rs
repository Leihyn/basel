use anchor_lang::prelude::*;
use crate::state::{OracleRate, OracleObservation};
use crate::errors::BaselError;

#[derive(Accounts)]
pub struct UpdateRate<'info> {
    #[account(
        mut,
        seeds = [b"oracle", oracle.pair.as_bytes()],
        bump = oracle.bump,
        has_one = authority @ BaselError::Unauthorized,
    )]
    pub oracle: Box<Account<'info, OracleRate>>,

    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdateRate>,
    rate: u64,
    bid: u64,
    ask: u64,
    timestamp: i64,
    source_hash: [u8; 32],
    vol_30d: u64,
    vol_90d: u64,
) -> Result<()> {
    let oracle = &mut ctx.accounts.oracle;
    oracle.rate = rate;
    oracle.bid = bid;
    oracle.ask = ask;
    oracle.timestamp = timestamp;
    oracle.source_hash = source_hash;
    oracle.vol_30d = vol_30d;
    oracle.vol_90d = vol_90d;
    oracle.updated_slot = Clock::get()?.slot;

    // Update TWAP ring buffer
    let idx = oracle.obs_index as usize;
    oracle.observations[idx] = OracleObservation { rate, timestamp };
    oracle.obs_index = ((idx + 1) % 6) as u8;
    if oracle.obs_count < 6 {
        oracle.obs_count += 1;
    }

    // Recompute TWAP
    let count = oracle.obs_count as u64;
    if count > 0 {
        let sum: u64 = oracle.observations[..count as usize]
            .iter()
            .map(|o| o.rate)
            .sum();
        oracle.twap = sum / count;
    }

    msg!("Oracle updated: {} rate={} twap={}", oracle.pair, rate, oracle.twap);
    Ok(())
}
