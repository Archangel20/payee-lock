#!/usr/bin/env node
// An agent checks Payee Lock before it pays.
// Exit 0 only when the registry says the address matches the payee.
//
//   node scripts/agent-verify.mjs --payee acme --chain ethereum --address 0x...
//
// PAYEE_LOCK_URL defaults to http://localhost:3000

const base = process.env.PAYEE_LOCK_URL || "http://localhost:3000";
const args = process.argv.slice(2);

function flag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const payee = flag("--payee");
const chain = flag("--chain");
const address = flag("--address");

if (!payee || !chain || !address) {
  console.error("Usage: node scripts/agent-verify.mjs --payee acme --chain ethereum --address 0x...");
  process.exit(1);
}

const url = new URL("/api/verify", base);
url.searchParams.set("payee", payee);
url.searchParams.set("chain", chain);
url.searchParams.set("address", address);

const response = await fetch(url);
const body = await response.json();
console.log(JSON.stringify(body, null, 2));

if (!response.ok) {
  console.error("\nRefusing to pay. The verifier did not answer.");
  process.exit(1);
}

if (body.status === "match") {
  console.log(`\nPayee confirmed. An agent may pay ${body.current} on ${body.chain}.`);
  process.exit(0);
}

console.error(`\nRefusing to pay. Status: ${body.status}.`);
if (body.lookalike) {
  console.error(
    `Lookalike of ${body.lookalike.registered} (first ${body.lookalike.prefix}, last ${body.lookalike.suffix}).`,
  );
}
if (body.current) console.error(`The address on file is ${body.current}.`);
process.exit(2);
