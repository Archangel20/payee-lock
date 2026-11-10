"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PayeeView } from "@/lib/types";

export function PayeeList() {
  const [payees, setPayees] = useState<PayeeView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/payees")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not list payees");
        if (!cancelled) setPayees(body.payees as PayeeView[]);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not list payees");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="section">
      <h2>Payees on this registry</h2>
      {error ? <p className="error">{error}</p> : null}
      {!payees ? <p className="muted">Reading testnet…</p> : null}
      {payees && payees.length === 0 ? (
        <p className="muted">No payees yet. Run npm run seed to register the demo companies.</p>
      ) : null}
      <div className="payee-grid">
        {payees?.map((payee) => (
          <Link key={payee.account_id} href={`/payee/${payee.account_id}`} className="payee-card">
            <strong>{payee.display_name}</strong>
            <span>{payee.account_id}</span>
            <span>{payee.addresses.length} chains · delay {payee.delay_seconds}s</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
