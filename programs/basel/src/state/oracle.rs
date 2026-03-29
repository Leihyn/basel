use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct OracleObservation {
    pub rate: u64,
    pub timestamp: i64,
}

#[account]
pub struct OracleRate {
    /// Currency pair identifier, e.g. "EUR/USD" (max 16 bytes)
    pub pair: String,
    /// Mid rate × 1e6 (e.g. 1.0842 stored as 1_084_200)
    pub rate: u64,
    /// Best bid × 1e6
    pub bid: u64,
    /// Best ask × 1e6
    pub ask: u64,
    /// SIX publish timestamp (unix seconds)
    pub timestamp: i64,
    /// SHA-256 of raw SIX API response body
    pub source_hash: [u8; 32],
    /// 30-day historical volatility × 1e4 (e.g. 6.88% = 688)
    pub vol_30d: u64,
    /// 90-day historical volatility × 1e4
    pub vol_90d: u64,
    /// Solana slot at last update
    pub updated_slot: u64,
    /// Relayer pubkey — only this key can update
    pub authority: Pubkey,
    /// PDA bump
    pub bump: u8,
    // --- TWAP fields ---
    /// Ring buffer of recent rate observations
    pub observations: [OracleObservation; 6],
    /// Current index in ring buffer
    pub obs_index: u8,
    /// Number of observations filled (max 6)
    pub obs_count: u8,
    /// Time-weighted average price × 1e6
    pub twap: u64,
}

impl OracleRate {
    // 8 discriminator + (4+16) pair + 8 rate + 8 bid + 8 ask + 8 timestamp
    // + 32 source_hash + 8 vol_30d + 8 vol_90d + 8 updated_slot + 32 authority + 1 bump
    // + (16*6) observations + 1 obs_index + 1 obs_count + 8 twap
    pub const SIZE: usize = 8 + (4 + 16) + 8 + 8 + 8 + 8 + 32 + 8 + 8 + 8 + 32 + 1
        + (16 * 6) + 1 + 1 + 8;
}
