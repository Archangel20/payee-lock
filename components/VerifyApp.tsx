"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AddressCode } from "@/components/AddressCode";
import { QuotePanel } from "@/components/QuotePanel";
import { CHAINS, chainLabel } from "@/lib/chains";
import type { VerifyResponse } from "@/lib/types";

function headline(result: VerifyResponse): string {
  const name = result.display_name ?? result.payee;
  const chain = chainLabel(result.chain);
  if (result.status === "match") return `This is ${name}'s real ${chain} address.`;
  if (result.status === "pending_change") {
    return `This is not payable yet. It is a pending change for ${name}.`;
  }
  if (result.status === "not_registered") return `No payee is registered as “${result.payee}”.`;
  return `This does not belong to ${name}.`;
}

export function VerifyApp() {
  const params = useSearchParams();
  const [payee, setPayee] = useState(params.get("payee") ?? "acme");
  const [chain, setChain] = useState(params.get("chain") ?? "ethereum");
  const [address, setAddress] = useState(params.get("address") ?? "");
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const url = new URL("/api/verify", window.location.origin);
    url.searchParams.set("payee", payee);
    url.searchParams.set("chain", chain);
    url.searchParams.set("address", address);
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) {
      setResult(null);
      setError(body.error ?? "Could not verify");
    } else {
      setResult(body as VerifyResponse);
    }
    setLoading(false);
  }

  const seal =
    result?.status === "match" ? "match" : result?.status === "pending_change" ? "pending" : "block";
  const sealText =
    result?.status === "match" ? "Match" : result?.status === "pending_change" ? "Pending" : "Do not pay";

  return (
    <>
      <div className="lede">
        <h1>Confirm the payee before the money moves.</h1>
        <p>
          Banks check that an account belongs to the person you named. Crypto does not. Paste an
          address and a payee. Payee Lock reads the public NEAR testnet registry and tells you
          whether it is the one on file.
        </p>
      </div>
      <div className="split">
        <form className="card" onSubmit={onSubmit}>
          <p className="kicker">Verifier</p>
          <label className="field">
            <span>Payee</span>
            <input value={payee} onChange={(event) => setPayee(event.target.value)} placeholder="acme" />
          </label>
          <label className="field">
            <span>Chain</span>
            <select value={chain} onChange={(event) => setChain(event.target.value)}>
              {CHAINS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Address to check</span>
            <textarea
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="0x… full address, not the shortened one from a wallet"
              required
            />
          </label>
          <div className="row">
            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Checking the registry…" : "Check this address"}
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={() => {
                setPayee("acme");
                setChain("ethereum");
                setAddress("0x4e8fa91c0d4e77b2c61890ab44f13c8e06e35d17");
              }}
            >
              Fill the poisoned example
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}
          <p className="small muted">
            No wallet connection. The check is a view call on the public testnet RPC.
          </p>
        </form>
        <section className="card result" aria-live="polite">
          {!result ? (
            <>
              <p className="kicker">Result</p>
              <h2>The full address, not the first and last characters.</h2>
              <p className="muted">
                Wallets hide the middle of an address. That is the gap address poisoning uses. This
                page shows every character and compares it to the registry.
              </p>
            </>
          ) : (
            <>
              <div className="seal-row">
                <div className={`seal ${seal}`}>
                  {sealText}
                </div>
                <div>
                  <p className="kicker">{result.status.replaceAll("_", " ")}</p>
                  <h2>{headline(result)}</h2>
                </div>
              </div>
              <div className="compare">
                <div>
                  <span className="kicker">Address you checked</span>
                  <AddressCode
                    value={result.queried}
                    prefix={result.lookalike?.prefix ?? 0}
                    suffix={result.lookalike?.suffix ?? 0}
                  />
                </div>
                {result.current ? (
                  <div>
                    <span className="kicker">Address on file</span>
                    <AddressCode
                      value={result.current}
                      prefix={result.lookalike?.prefix ?? 0}
                      suffix={result.lookalike?.suffix ?? 0}
                    />
                  </div>
                ) : null}
              </div>
              {result.lookalike ? (
                <p className="banner red">
                  Lookalike. The first {result.lookalike.prefix} and last {result.lookalike.suffix}{" "}
                  characters match the registered address. The middle does not. Do not pay it.
                </p>
              ) : null}
              {result.status === "pending_change" && result.activates_at_ms ? (
                <p className="banner">
                  This change is public and not active yet. Until{" "}
                  {new Date(result.activates_at_ms).toLocaleString()}, the address on file is still
                  the one that verifies.
                </p>
              ) : null}
              {result.status !== "not_registered" ? (
                <p className="small">
                  <Link href={`/payee/${result.payee}`}>Open {result.display_name ?? result.payee}&apos;s profile</Link>
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>
      {result?.status === "match" ? <QuotePanel payee={result.payee} ready /> : null}
      {result && result.status !== "match" && result.status !== "not_registered" ? (
        <p className="banner red">Payment blocked. A quote is only requested for an address the registry currently matches.</p>
      ) : null}
    </>
  );
}
