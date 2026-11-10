import { ORIGINS, type OriginId } from "@/lib/origins";

export const ETH_USDC = "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near";

export type { OriginId };

/** One attempt. A slow solver must not keep the HTTP handler open. */
const ATTEMPT_MS = 12_000;

export const INTENTS_TIMEOUT_CODE = "intents_timeout";
export const INTENTS_TIMEOUT_MESSAGE = "NEAR Intents didn't respond in time. Try again.";

export class QuoteError extends Error {
  readonly code: string;
  constructor(message: string, code = "intents_error") {
    super(message);
    this.name = "QuoteError";
    this.code = code;
  }
}

type QuoteBody = {
  quote?: {
    amountInFormatted?: string;
    amountOutFormatted?: string;
    amountInUsd?: string;
    amountOutUsd?: string;
    timeEstimate?: number;
  };
  correlationId?: string;
  signature?: string;
  timestamp?: string;
  message?: string;
};

type Attempt =
  | { ok: true; body: QuoteBody }
  | { ok: false; message: string; timedOut: boolean; retryable: boolean };

async function requestQuote(url: string, headers: Record<string, string>, payload: unknown): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: QuoteBody = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as QuoteBody;
      } catch {
        parsed = { message: text.slice(0, 180) };
      }
    }
    if (response.ok && parsed.quote?.amountOutFormatted) return { ok: true, body: parsed };
    const message = parsed.message || `Intents quote failed (${response.status})`;
    const timedOut = response.status === 504 || /timeout/i.test(message);
    return {
      ok: false,
      message,
      timedOut,
      retryable: timedOut || response.status >= 500 || response.status === 0,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      message: aborted ? INTENTS_TIMEOUT_MESSAGE : error instanceof Error ? error.message : "Quote failed",
      timedOut: aborted,
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function dryQuote(originId: OriginId, recipient: string) {
  const origin = ORIGINS.find((item) => item.id === originId);
  if (!origin) throw new QuoteError("Unknown payment origin");
  const deadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const endpoint = process.env.INTENTS_API_URL || "https://1click.chaindefuser.com";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": "payee-lock",
  };
  if (process.env.INTENTS_JWT) headers.authorization = `Bearer ${process.env.INTENTS_JWT}`;

  const payload = {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: origin.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: ETH_USDC,
    amount: origin.amount,
    recipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo: origin.id === "ethereum" ? recipient : origin.refundTo,
    refundType: "ORIGIN_CHAIN",
    deadline,
    quoteWaitingTimeMs: 0,
  };

  let attempt = await requestQuote(`${endpoint}/v0/quote`, headers, payload);
  if (!attempt.ok && attempt.retryable) {
    attempt = await requestQuote(`${endpoint}/v0/quote`, headers, payload);
  }
  if (!attempt.ok) {
    if (attempt.timedOut) throw new QuoteError(INTENTS_TIMEOUT_MESSAGE, INTENTS_TIMEOUT_CODE);
    throw new QuoteError(attempt.message);
  }

  const body = attempt.body;
  return {
    simulatedExecution: true as const,
    dryRun: true as const,
    label:
      "Simulated execution. This is a live dry quote from the NEAR Intents 1Click API. dry: true means no deposit address was created and no funds moved. Intents has no testnet.",
    correlationId: body.correlationId ?? "",
    signature: body.signature ?? "",
    timestamp: body.timestamp ?? "",
    amountInFormatted: body.quote?.amountInFormatted ?? "",
    amountOutFormatted: body.quote?.amountOutFormatted ?? "",
    amountInUsd: body.quote?.amountInUsd ?? "",
    amountOutUsd: body.quote?.amountOutUsd ?? "",
    timeEstimateSeconds: body.quote?.timeEstimate ?? 0,
    originSymbol: origin.originSymbol,
    originChain: origin.originChain,
    destinationSymbol: "USDC",
    destinationChain: "Ethereum",
    recipient,
    depositType: "ORIGIN_CHAIN",
  };
}
