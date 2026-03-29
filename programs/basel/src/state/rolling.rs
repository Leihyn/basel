use anchor_lang::prelude::*;
use super::vault::DCIDirection;

#[account]
pub struct RollingStrategy {
    /// Strategy owner
    pub owner: Pubkey,
    /// Vault this strategy operates on
    pub vault: Pubkey,
    /// DCI direction
    pub direction: DCIDirection,
    /// Strike offset from spot in basis points (e.g. 200 = 2%)
    pub strike_offset_bps: u64,
    /// Tenor for each DCI in seconds
    pub tenor_seconds: i64,
    /// Amount per DCI position
    pub amount: u64,
    /// Whether strategy is active
    pub active: bool,
    /// Current active position (Pubkey::default if none)
    pub current_position: Pubkey,
    /// Timestamp of last roll
    pub last_roll_at: i64,
    /// PDA bump
    pub bump: u8,
}

impl RollingStrategy {
    // 8 discriminator + 32 owner + 32 vault + 1 direction + 8 strike_offset_bps
    // + 8 tenor_seconds + 8 amount + 1 active + 32 current_position + 8 last_roll_at + 1 bump
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 8 + 8 + 8 + 1 + 32 + 8 + 1;
}
