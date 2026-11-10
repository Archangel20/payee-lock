import type { Lookalike } from "@/lib/types";

const EVM = new Set(["ethereum", "base", "arbitrum", "polygon"]);

/** Compare the characters a wallet would hide in the middle. */
export function comparable(chain: string, address: string): string {
  const trimmed = address.trim();
  if (EVM.has(chain) || /^0x/i.test(trimmed)) {
    return trimmed.toLowerCase().replace(/^0x/, "");
  }
  if (chain === "bitcoin" && /^(bc1|tb1)/i.test(trimmed)) return trimmed.toLowerCase();
  if (chain === "near") return trimmed.toLowerCase();
  return trimmed;
}

/**
 * Address poisoning copies the first and last 4–6 characters and changes
 * the middle, because wallets abbreviate the middle.
 */
export function findLookalike(
  chain: string,
  candidate: string,
  registered: Array<string | null | undefined>,
): Lookalike | null {
  const body = comparable(chain, candidate);
  let best: Lookalike | null = null;
  for (const item of registered) {
    if (!item) continue;
    const other = comparable(chain, item);
    if (!other || other === body) continue;
    if (body.length < 12 || other.length < 12) continue;
    const limit = Math.min(6, body.length, other.length);
    let prefix = 0;
    let suffix = 0;
    for (let i = 0; i < limit; i += 1) {
      if (body[i] !== other[i]) break;
      prefix = i + 1;
    }
    for (let i = 0; i < limit; i += 1) {
      if (body[body.length - 1 - i] !== other[other.length - 1 - i]) break;
      suffix = i + 1;
    }
    if (prefix >= 4 && suffix >= 4 && prefix + suffix < Math.min(body.length, other.length)) {
      if (!best || prefix + suffix > best.prefix + best.suffix) {
        best = { registered: item, prefix, suffix };
      }
    }
  }
  return best;
}
