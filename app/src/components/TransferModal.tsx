"use client";

import { useState } from "react";

interface TransferModalProps {
  positionPubkey: string;
  onClose: () => void;
  onTransfer: (newOwner: string) => Promise<string>;
}

export default function TransferModal({
  positionPubkey,
  onClose,
  onTransfer,
}: TransferModalProps) {
  const [newOwner, setNewOwner] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ tx?: string; error?: string } | null>(null);

  async function handleTransfer() {
    if (!newOwner) return;
    setSubmitting(true);
    setResult(null);
    try {
      const tx = await onTransfer(newOwner);
      setResult({ tx });
    } catch (e: any) {
      setResult({ error: e.message || "Transfer failed" });
    }
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-card border border-border rounded-xl p-6 max-w-md w-full mx-4">
        <h3 className="font-semibold mb-4">Transfer Position</h3>
        <p className="text-xs text-zinc-500 mb-4 font-mono">{positionPubkey.slice(0, 24)}...</p>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-zinc-400 block mb-1">
              Destination Wallet
            </label>
            <input
              type="text"
              value={newOwner}
              onChange={(e) => setNewOwner(e.target.value)}
              placeholder="Enter Solana wallet address"
              className="w-full bg-bg-secondary border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
            />
          </div>

          {result?.tx && (
            <div className="p-3 bg-accent-green/10 border border-accent-green/20 rounded-lg">
              <p className="text-sm text-accent-green">Transferred!</p>
              <a
                href={`https://explorer.solana.com/tx/${result.tx}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:underline font-mono"
              >
                {result.tx.slice(0, 24)}...
              </a>
            </div>
          )}

          {result?.error && (
            <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded-lg text-sm text-accent-red">
              {result.error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2 bg-bg-secondary border border-border rounded-lg text-sm hover:bg-bg-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleTransfer}
              disabled={submitting || !newOwner}
              className="flex-1 py-2 bg-accent rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-600 transition-colors"
            >
              {submitting ? "Transferring..." : "Transfer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
