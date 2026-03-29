"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (m) => m.WalletMultiButton
    ),
  { ssr: false }
);

const links = [
  { href: "/", label: "Home" },
  { href: "/invest", label: "Invest" },
  { href: "/positions", label: "Positions" },
  { href: "/rates", label: "Rates" },
  { href: "/vault", label: "Vault" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border bg-bg-primary/90 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-[3px] h-6 bg-brand-bar rounded-full" />
            <span className="text-lg font-extrabold tracking-tight text-brand-white">
              Basel
            </span>
          </Link>
          <div className="flex gap-0.5">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  pathname === link.href
                    ? "bg-bg-hover text-white font-semibold"
                    : "text-zinc-400 hover:text-zinc-100 hover:bg-bg-hover"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <WalletMultiButton
          style={{
            background: "#a0a0ab",
            height: "34px",
            fontSize: "13px",
            borderRadius: "6px",
            fontWeight: 600,
            color: "#1a1a1e",
          }}
        />
      </div>
    </nav>
  );
}
