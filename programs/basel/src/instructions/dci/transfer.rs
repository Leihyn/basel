use anchor_lang::prelude::*;
use crate::state::{DCIPosition, DCIStatus};
use crate::errors::BaselError;

#[derive(Accounts)]
pub struct TransferPosition<'info> {
    #[account(
        mut,
        constraint = position.status == DCIStatus::Active @ BaselError::DCIAlreadySettled,
        constraint = position.owner == owner.key() @ BaselError::TransferNotOwner,
    )]
    pub position: Box<Account<'info, DCIPosition>>,

    pub owner: Signer<'info>,

    /// CHECK: New owner to transfer position to
    pub new_owner: AccountInfo<'info>,
}

pub fn handler(ctx: Context<TransferPosition>) -> Result<()> {
    let position = &mut ctx.accounts.position;
    let old_owner = position.owner;
    position.owner = ctx.accounts.new_owner.key();

    msg!(
        "Position transferred: {} -> {}",
        old_owner,
        position.owner
    );
    Ok(())
}
