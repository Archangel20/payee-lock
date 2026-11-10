"use client";

import { useState } from "react";
import Link from "next/link";
import demo from "@/config/demo-payees.json";
import deployed from "@/config/deployed.json";
import { AddressCode } from "@/components/AddressCode";
import { Countdown } from "@/components/Countdown";
import { QuotePanel } from "@/components/QuotePanel";
import type { PayeeView, VerifyResponse } from "@/lib/types";

const spec = demo.payees.find((payee) => payee.slug === "acme");
const registered = deployed.payees.find((payee) => payee.slug === "acme");

const STEPS = [
  { id: "invoice", title: "The invoice", detail: "Acme's email asks you to pay a lookalike address." },
  { id: "check", title: "Check it", detail: "The registry flags it and shows the real address." },
  { id: "pay", title: "Pay the real one", detail: "A live Intents quote. Sending is simulated." },
  { id: "attack", title: "The swap", detail: "A compromised payee key proposes a new address." },
  { id: "veto", title: "The veto", detail: "The guardian rejects it. The old address still matches." },
] as const;

type StepId = (typeof STEPS)[number]["id"];
type Profile = PayeeView & { chain_time_ms: number };

export function DemoApp() {
  const accountId = registered?.accountId ?? "";
  const poison = registered?.poison?.address ?? spec?.poison?.address ?? "";
  const real = registered?.addresses.ethereum ?? spec?.addresses.ethereum ?? "";
  const [step, setStep] = useState<StepId>("invoice");
  const [check, setCheck] = useState<VerifyResponse | null>(null);
  const [after, setAfter] = useState<VerifyResponse | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<string | null>(null);

  async function runCheck() {
    setBusy(true);
    setError(null);
    const url = new URL("/api/verify", window.location.origin);
    url.searchParams.set("payee", accountId || "acme");
    url.searchParams.set("chain", "ethereum");
    url.searchParams.set("address", poison);
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) setError(body.error ?? "Check failed");
    else {
      setCheck(body as VerifyResponse);
      setStep("check");
    }
    setBusy(false);
  }

  async function refreshProfile() {
    const response = await fetch(`/api/payee?account=${encodeURIComponent(accountId)}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load Acme");
    setProfile(body as Profile);
    return body as Profile;
  }

  async function waitForProfile(ready: (profile: Profile) => boolean) {
    let latest: Profile | null = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      latest = await refreshProfile();
      if (ready(latest)) return latest;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    return latest;
  }

  async function propose() {
    setBusy(true);
    setError(null);
    setTx(null);
    try {
      const current = await refreshProfile();
      const eth = current.addresses.find((item) => item.chain === "ethereum");
      if (eth?.pending && eth.pending.toLowerCase() !== poison.toLowerCase()) {
        await postTx("veto");
        await waitForProfile((next) => !next.addresses.find((item) => item.chain === "ethereum")?.pending);
      }
      if (eth?.pending?.toLowerCase() !== poison.toLowerCase()) {
        const sent = await postTx("propose");
        setTx(sent);
      }
      await waitForProfile((next) => {
        const slot = next.addresses.find((item) => item.chain === "ethereum");
        return slot?.pending?.toLowerCase() === poison.toLowerCase();
      });
      setStep("attack");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Propose failed");
    }
    setBusy(false);
  }

  async function veto() {
    setBusy(true);
    setError(null);
    try {
      const sent = await postTx("veto");
      setTx(sent);
      await waitForProfile((next) => {
        const slot = next.addresses.find((item) => item.chain === "ethereum");
        return !slot?.pending;
      });
      const url = new URL("/api/verify", window.location.origin);
      url.searchParams.set("payee", accountId);
      url.searchParams.set("chain", "ethereum");
      url.searchParams.set("address", poison);
      const response = await fetch(url);
      setAfter((await response.json()) as VerifyResponse);
      setStep("veto");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Veto failed");
    }
    setBusy(false);
  }

  async function postTx(action: "propose" | "veto") {
    const response = await fetch("/api/tx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        payee: accountId,
        chain: "ethereum",
        address: poison,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Transaction failed");
    return (body.transactionId as string | null) ?? "submitted";
  }

  const pending = profile?.addresses.find((item) => item.chain === "ethereum");

  return (
    <>
      <div className="lede">
        <h1>A 60-second demo.</h1>
        <p>
          An invoice carries a poisoned Ethereum address. The registry stops the payment, then a
          stolen payee key tries to replace the address on file. The guardian vetoes it during the
          public delay. Every chain step is a real testnet transaction.
        </p>
      </div>
      {!accountId ? (
        <p className="banner">
          The demo payees are not in config/deployed.json yet. Run <code>npm run seed</code> and
          restart the app.
        </p>
      ) : null}
      <div className="split">
        <div className="stepper">
          {STEPS.map((item, index) => (
            <button
              key={item.id}
              className={step === item.id ? "active" : ""}
              type="button"
              onClick={() => setStep(item.id)}
            >
              <span>Step {index + 1}</span>
              {item.title}
              <div className="small muted">{item.detail}</div>
            </button>
          ))}
        </div>
        <div>
          {step === "invoice" ? (
            <article className="email">
              <header>
                <p><strong>From:</strong> accounts@acme.example</p>
                <p><strong>Subject:</strong> Invoice 1042 — 10 USDC due today</p>
              </header>
              <div className="body">
                <p>Please settle invoice 1042 on Ethereum. Pay the address below and reply with the transaction.</p>
                <p><AddressCode value={poison} prefix={4} suffix={4} /></p>
                <button className="btn" type="button" disabled={!accountId || busy} onClick={runCheck}>
                  {busy ? "Checking…" : "Check this address"}
                </button>
              </div>
            </article>
          ) : null}
          {step === "check" ? (
            <section className="card result">
              <div className="seal-row">
                <div className="seal block">Do not pay</div>
                <h2>This does not belong to Acme Treasury.</h2>
              </div>
              {check?.lookalike ? (
                <p className="banner red">
                  Lookalike of the registered address. First {check.lookalike.prefix}, last{" "}
                  {check.lookalike.suffix}. The middle is the attack.
                </p>
              ) : (
                <p className="banner red">The invoice address is not the one on file.</p>
              )}
              <div className="compare">
                <div>
                  <span className="kicker">Invoice</span>
                  <AddressCode value={poison} prefix={check?.lookalike?.prefix ?? 4} suffix={check?.lookalike?.suffix ?? 4} />
                </div>
                <div>
                  <span className="kicker">Acme&apos;s real Ethereum address</span>
                  <AddressCode value={check?.current ?? real} prefix={check?.lookalike?.prefix ?? 4} suffix={check?.lookalike?.suffix ?? 4} />
                </div>
              </div>
              <button className="btn" type="button" onClick={() => setStep("pay")}>Continue to pay the real address</button>
            </section>
          ) : null}
          {step === "pay" && accountId ? (
            <div>
              <QuotePanel payee={accountId} ready />
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn secondary" type="button" onClick={() => setStep("attack")}>
                  Next: the attacker proposes a swap
                </button>
              </div>
            </div>
          ) : null}
          {step === "attack" ? (
            <section className="card">
              <p className="kicker">Compromised payee key</p>
              <h2>The attacker proposes the poisoned address as Acme&apos;s new one.</h2>
              <p className="small">
                This call is signed by Acme&apos;s key, which is what a stolen owner key can do.
                It cannot remove the guardian. Until the delay ends, the old address still verifies.
              </p>
              <button className="btn danger" type="button" disabled={!accountId || busy} onClick={propose}>
                {busy ? "Submitting…" : "Propose the address swap"}
              </button>
              {pending?.pending ? (
                <div className="banner" style={{ marginTop: 14 }}>
                  <div>Pending change. Old address remains authoritative.</div>
                  {pending.activates_at_ms && profile ? (
                    <Countdown activatesAt={pending.activates_at_ms} chainNow={profile.chain_time_ms} />
                  ) : null}
                  <div className="small">Proposed {pending.pending}</div>
                  <button className="btn" type="button" onClick={() => setStep("veto")}>Guardian can veto this</button>
                </div>
              ) : null}
              {tx ? <p className="small muted">Transaction {tx}</p> : null}
            </section>
          ) : null}
          {step === "veto" ? (
            <section className="card result">
              <p className="kicker">Guardian veto</p>
              <h2>Stop the change before the window closes.</h2>
              <button className="btn" type="button" disabled={!accountId || busy} onClick={veto}>
                {busy ? "Vetoing…" : "Veto with the guardian key"}
              </button>
              {after ? (
                <p className={after.status === "no_match" ? "banner green" : "banner red"}>
                  After the veto, the poisoned address is <strong>{after.status.replaceAll("_", " ")}</strong>.
                  The address that still verifies is {after.current}.
                </p>
              ) : null}
              {tx ? <p className="small muted">Transaction {tx}</p> : null}
              {accountId ? <p><Link href={`/payee/${accountId}`}>Open the profile and the activity log</Link></p> : null}
            </section>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
        </div>
      </div>
    </>
  );
}
