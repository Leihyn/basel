use anchor_lang::prelude::*;

#[account]
pub struct KYCRecord {
    /// The wallet address this KYC record applies to
    pub wallet: Pubkey,
    /// KYC level: 0=none, 1=basic, 2=enhanced
    pub kyc_level: u8,
    /// When this wallet was approved (unix seconds)
    pub approved_at: i64,
    /// When this KYC record expires (unix seconds)
    pub expires_at: i64,
    /// Compliance officer who approved this wallet
    pub authority: Pubkey,
    /// SHA-256 of off-chain compliance payload (KYC provider, screening results, etc.)
    pub compliance_hash: [u8; 32],
    /// PDA bump
    pub bump: u8,
}

impl KYCRecord {
    // 8 discriminator + 32 wallet + 1 kyc_level + 8 approved_at + 8 expires_at
    // + 32 authority + 32 compliance_hash + 1 bump
    pub const SIZE: usize = 8 + 32 + 1 + 8 + 8 + 32 + 32 + 1;
}
