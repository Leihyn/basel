use anchor_lang::prelude::*;

use super::vault::DCIDirection;

#[account]
pub struct Attestation {
    /// DCI position this attestation records
    pub position: Pubkey,
    /// Position owner (sender/depositor)
    pub sender: Pubkey,
    /// Vault pubkey
    pub vault: Pubkey,
    /// Amount deposited
    pub amount_in: u64,
    /// Amount returned/converted
    pub amount_out: u64,
    /// Currency pair
    pub pair: String,
    /// SIX rate at settlement × 1e6
    pub six_rate: u64,
    /// SIX rate timestamp
    pub six_timestamp: i64,
    /// Source hash from oracle at settlement time
    pub source_hash: [u8; 32],
    /// Compliance hash from the DCI position
    pub compliance_hash: [u8; 32],
    /// Whether conversion occurred
    pub converted: bool,
    /// Direction of the DCI
    pub direction: DCIDirection,
    /// When attestation was created (unix seconds)
    pub created_at: i64,
    /// PDA bump
    pub bump: u8,
}

impl Attestation {
    // 8 discriminator + 32 position + 32 sender + 32 vault + 8 amount_in + 8 amount_out
    // + (4+16) pair + 8 six_rate + 8 six_timestamp + 32 source_hash + 32 compliance_hash
    // + 1 converted + 1 direction + 8 created_at + 1 bump
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 8 + 8 + (4 + 16) + 8 + 8 + 32 + 32 + 1 + 1 + 8 + 1;
}
