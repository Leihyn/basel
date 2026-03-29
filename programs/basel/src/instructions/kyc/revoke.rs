use anchor_lang::prelude::*;
use crate::state::KYCRecord;
use crate::errors::BaselError;

#[derive(Accounts)]
pub struct RevokeWallet<'info> {
    #[account(
        mut,
        close = authority,
        seeds = [b"kyc", kyc_record.wallet.as_ref()],
        bump = kyc_record.bump,
        has_one = authority @ BaselError::Unauthorized,
    )]
    pub kyc_record: Account<'info, KYCRecord>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<RevokeWallet>) -> Result<()> {
    msg!("KYC revoked: wallet={}", ctx.accounts.kyc_record.wallet);
    Ok(())
}
