import Link from "next/link";

export function HowItWorks() {
  return (
    <section className="section">
      <h2>What the registry enforces</h2>
      <p className="muted">
        The first addresses a payee publishes are active immediately. Every change after that sits
        in public for a delay. The old address keeps matching until the delay ends, and a guardian
        the payee cannot dismiss can veto.
      </p>
      <div className="steps">
        <article>
          <h3>1. Named payee</h3>
          <p>A NEAR account such as acme.testnet is the payee. You check a name, not a hex string someone pasted into an invoice.</p>
        </article>
        <article>
          <h3>2. Time-locked change</h3>
          <p>A proposal is an event, not a payment destination. Verify keeps returning the previous address until the window closes.</p>
        </article>
        <article>
          <h3>3. Then pay</h3>
          <p>
            A match can be paid from another chain through NEAR Intents. The demo quote is live.
            Sending funds is labeled simulated. <Link href="/demo">Run the scripted demo.</Link>
          </p>
        </article>
      </div>
    </section>
  );
}
