use anchor_lang::prelude::*;

#[error_code]
pub enum BaselError {
    #[msg("Unauthorized: signer is not the expected authority")]
    Unauthorized,

    #[msg("Oracle rate is stale (older than max allowed age)")]
    OracleStale,

    #[msg("KYC record has expired")]
    KYCExpired,

    #[msg("Wallet is not KYC approved")]
    KYCNotApproved,

    #[msg("KYC level insufficient for this operation")]
    KYCLevelInsufficient,

    #[msg("Vault has insufficient liquidity for this operation")]
    VaultInsufficientLiquidity,

    #[msg("DCI position has not expired yet")]
    DCINotExpired,

    #[msg("DCI position has already been settled")]
    DCIAlreadySettled,

    #[msg("Invalid strike price")]
    InvalidStrike,

    #[msg("Invalid expiry timestamp (must be in the future)")]
    InvalidExpiry,

    #[msg("Invalid premium amount")]
    InvalidPremium,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Currency pair string too long (max 16 bytes)")]
    PairTooLong,

    #[msg("Invalid deposit side")]
    InvalidSide,

    // --- New error codes for improvements ---

    #[msg("Position transfer: signer is not the current owner")]
    TransferNotOwner,

    #[msg("Premium is below minimum required by current volatility")]
    PremiumTooLow,

    #[msg("Rolling strategy is not active")]
    RollingStrategyInactive,

    #[msg("Current rolling position has not been settled yet")]
    RollingPositionNotSettled,

    #[msg("Invalid upper strike (must be greater than lower strike for range DCI)")]
    InvalidStrikeUpper,

    #[msg("TWAP not available (insufficient observations)")]
    TwapNotAvailable,

    #[msg("Cash-settled vaults only allow QuoteToBase direction")]
    CashSettlementOnly,
}
