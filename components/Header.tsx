import Link from "next/link";
import { getDeployed } from "@/lib/config";

export function Header() {
  const { payees } = getDeployed();
  const acme = payees.find((payee) => payee.slug === "acme");
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="brand-mark">Payee Lock</span>
        <span className="brand-sub">Confirmation of payee</span>
      </Link>
      <nav>
        <Link href="/">Verify</Link>
        <Link href="/demo">Demo</Link>
        {acme ? <Link href={`/payee/${acme.accountId}`}>Acme</Link> : null}
        <span className="net">NEAR testnet · no wallet</span>
      </nav>
    </header>
  );
}
