use anchor_lang::prelude::*;

/// Settlement mode for the vault
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SettlementMode {
    /// Token swap settlement (e.g. USDC <-> EURC)
    Physical,
    /// Cash-only settlement in quote token (e.g. gold DCI settled in USDC)
    CashSettled,
}

#[account]
pub struct Vault {
    /// Currency pair this vault serves (e.g. "EUR/USD")
    pub pair: String,
    /// Base currency mint (e.g. EURC)
    pub base_mint: Pubkey,
    /// Quote currency mint (e.g. USDC)
    pub quote_mint: Pubkey,
    /// Vault's base token account (PDA-owned)
    pub base_token_account: Pubkey,
    /// Vault's quote token account (PDA-owned)
    pub quote_token_account: Pubkey,
    /// Vault admin authority
    pub authority: Pubkey,
    /// Next position nonce (incremented per DCI created)
    pub next_nonce: u64,
    /// PDA bump
    pub bump: u8,
    // --- Exposure tracking ---
    /// Total amount locked in active BaseToQuote DCI positions
    pub total_base_exposure: u64,
    /// Total amount locked in active QuoteToBase DCI positions
    pub total_quote_exposure: u64,
    /// Settlement mode for this vault
    pub settlement_mode: SettlementMode,
}

impl Vault {
    // 8 discriminator + (4+16) pair + 32×5 mints/accounts/authority + 8 nonce + 1 bump
    // + 8 base_exposure + 8 quote_exposure + 1 settlement_mode
    pub const SIZE: usize = 8 + (4 + 16) + 32 + 32 + 32 + 32 + 32 + 8 + 1 + 8 + 8 + 1;
}

/// Direction of the DCI
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum DCIDirection {
    /// User deposits base (e.g. EURC), may receive quote (USDC) if rate >= strike
    BaseToQuote,
    /// User deposits quote (e.g. USDC), may receive base (EURC) if rate < strike
    QuoteToBase,
}

/// Status of a DCI position
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum DCIStatus {
    Active,
    Settled,
}

#[account]
pub struct DCIPosition {
    /// Position owner
    pub owner: Pubkey,
    /// Vault this position trades against
    pub vault: Pubkey,
    /// Strike price × 1e6 (lower strike for range DCI)
    pub strike: u64,
    /// Expiry timestamp (unix seconds)
    pub expiry: i64,
    /// Deposit amount (in deposited token's smallest unit)
    pub amount: u64,
    /// Direction of the DCI
    pub direction: DCIDirection,
    /// Premium rate × 1e6 (e.g. 0.3% = 3000)
    pub premium_rate: u64,
    /// Actual premium paid to user (in deposited token units)
    pub premium_paid: u64,
    /// Current status
    pub status: DCIStatus,
    /// Oracle rate at settlement × 1e6 (0 if not settled)
    pub settlement_rate: u64,
    /// Amount returned/converted to user at settlement
    pub settlement_amount: u64,
    /// SHA-256 of compliance payload at position creation
    pub compliance_hash: [u8; 32],
    /// Position nonce (unique per vault)
    pub nonce: u64,
    /// When position was created (unix seconds)
    pub created_at: i64,
    /// PDA bump
    pub bump: u8,
    // --- Range DCI ---
    /// Upper strike for range DCI × 1e6 (0 = standard single-strike DCI)
    pub strike_upper: u64,
}

impl DCIPosition {
    // 8 discriminator + 32 owner + 32 vault + 8 strike + 8 expiry + 8 amount
    // + 1 direction + 8 premium_rate + 8 premium_paid + 1 status + 8 settlement_rate
    // + 8 settlement_amount + 32 compliance_hash + 8 nonce + 8 created_at + 1 bump
    // + 8 strike_upper
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 8 + 8 + 1 + 8 + 8 + 32 + 8 + 8 + 1 + 8;
}
