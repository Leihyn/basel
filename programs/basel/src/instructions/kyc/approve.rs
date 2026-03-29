use anchor_lang::prelude::*;
use crate::state::KYCRecord;

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct ApproveWallet<'info> {
    #[account(
        init,
        payer = authority,
        space = KYCRecord::SIZE,
        seeds = [b"kyc", wallet.as_ref()],
        bump,
    )]
    pub kyc_record: Account<'info, KYCRecord>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<ApproveWallet>,
    wallet: Pubkey,
    kyc_level: u8,
    expires_at: i64,
    compliance_hash: [u8; 32],
) -> Result<()> {
    let kyc = &mut ctx.accounts.kyc_record;
    kyc.wallet = wallet;
    kyc.kyc_level = kyc_level;
    kyc.approved_at = Clock::get()?.unix_timestamp;
    kyc.expires_at = expires_at;
    kyc.authority = ctx.accounts.authority.key();
    kyc.compliance_hash = compliance_hash;
    kyc.bump = ctx.bumps.kyc_record;

    msg!("KYC approved: wallet={} level={}", wallet, kyc_level);
    Ok(())
}
