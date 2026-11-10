"use client";

import { useState } from "react";
import { ORIGINS } from "@/lib/origins";
import type { QuoteResponse } from "@/lib/types";

export function QuotePanel({ payee, ready }: { payee: string; ready: boolean }) {
  const [origin, setOrigin] = useState<(typeof ORIGINS)[number]["id"]>("near-usdc");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [asked, setAsked] = useState(false);

  async function loadQuote() {
    setLoading(true);
    setError(null);
    setAsked(false);
    setQuote(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payee, origin }),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      } & Partial<QuoteResponse>;
      const timedOut = body.code === "intents_timeout" || response.status === 504;
      if (!response.ok || timedOut) {
        setError(timedOut ? "NEAR Intents didn't respond in time. Try again." : (body.error ?? "Quote failed"));
        return;
      }
      if (!body.amountOutFormatted) {
        setError("Quote failed");
        return;
      }
      setQuote(body as QuoteResponse);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      setError(
        aborted
          ? "NEAR Intents didn't respond in time. Try again."
          : "Could not reach the quote service. Try again.",
      );
    } finally {
      window.clearTimeout(timer);
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <p className="kicker">Pay the verified address</p>
      <p className="small">
        NEAR Intents can settle this payee from another chain. The recipient is the Ethereum address
        the registry currently verifies. The quote is live. The send is not.
      </p>
      <div className="field">
        <span>Pay from</span>
        <select value={origin} onChange={(event) => setOrigin(event.target.value as typeof origin)}>
          {ORIGINS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <button className="btn" type="button" disabled={!ready || loading} onClick={loadQuote}>
          {loading ? "Asking Intents…" : "Get a live quote"}
        </button>
        <button className="btn secondary" type="button" disabled={!quote} onClick={() => setAsked(true)}>
          Execute swap
        </button>
      </div>
      {error ? (
        <div className="banner" role="alert">
          <p style={{ margin: "0 0 10px" }}>{error}</p>
          <button className="btn secondary" type="button" onClick={loadQuote} disabled={loading}>
            Try again
          </button>
        </div>
      ) : null}
      {quote ? (
        <>
          <div className="quote-grid">
            <div>
              <span className="kicker">You pay</span>
              <strong>
                {quote.amountInFormatted} {quote.originSymbol}
              </strong>
              <span className="small muted">{quote.originChain}</span>
            </div>
            <div>
              <span className="kicker">Payee receives</span>
              <strong>
                {quote.amountOutFormatted} {quote.destinationSymbol}
              </strong>
              <span className="small muted">
                about ${Number(quote.amountOutUsd).toFixed(2)} · {quote.timeEstimateSeconds}s
              </span>
            </div>
          </div>
          <p className="small">
            Recipient <code className="addr">{quote.recipient}</code>
          </p>
          <p className="banner">{quote.label}</p>
          <p className="small muted">
            Quote {quote.correlationId} · deposit type {quote.depositType} · signed {quote.signature.slice(0, 24)}…
          </p>
        </>
      ) : null}
      {asked ? (
        <p className="banner red">
          Execution is simulated. A live swap would be a second 1Click call with dry set to false, which
          returns a mainnet deposit address. This demo never makes that call and never sends funds.
          Intents has no testnet.
        </p>
      ) : null}
    </div>
  );
}
