import { ORIGINS, type OriginId } from "@/lib/origins";

export const ETH_USDC = "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near";

export type { OriginId };

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

export async function dryQuote(originId: OriginId, recipient: string) {
  const origin = ORIGINS.find((item) => item.id === originId);
  if (!origin) throw new Error("Unknown payment origin");
  const deadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const endpoint = process.env.INTENTS_API_URL || "https://1click.chaindefuser.com";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.INTENTS_JWT) headers.authorization = `Bearer ${process.env.INTENTS_JWT}`;

  const attempts: Array<{ depositType: string; refundType: string }> = [
    { depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN" },
    { depositType: "INTENTS", refundType: "INTENTS" },
  ];

  let lastError = "NEAR Intents did not return a quote";
  for (const attempt of attempts) {
    const response = await fetch(`${endpoint}/v0/quote`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        dry: true,
        swapType: "EXACT_INPUT",
        slippageTolerance: 100,
        originAsset: origin.originAsset,
        depositType: attempt.depositType,
        destinationAsset: ETH_USDC,
        amount: origin.amount,
        recipient,
        recipientType: "DESTINATION_CHAIN",
        refundTo:
          attempt.refundType === "INTENTS" ? "wrap.near" : origin.id === "ethereum" ? recipient : origin.refundTo,
        refundType: attempt.refundType,
        deadline,
      }),
      cache: "no-store",
    });
    const body = (await response.json()) as QuoteBody;
    if (!response.ok || !body.quote) {
      lastError = body.message || `Intents quote failed (${response.status})`;
      continue;
    }
    return {
      simulatedExecution: true as const,
      dryRun: true as const,
      label:
        "Simulated execution. This is a live dry quote from the NEAR Intents 1Click API. dry: true means no deposit address was created and no funds moved. Intents has no testnet.",
      correlationId: body.correlationId ?? "",
      signature: body.signature ?? "",
      timestamp: body.timestamp ?? "",
      amountInFormatted: body.quote.amountInFormatted ?? "",
      amountOutFormatted: body.quote.amountOutFormatted ?? "",
      amountInUsd: body.quote.amountInUsd ?? "",
      amountOutUsd: body.quote.amountOutUsd ?? "",
      timeEstimateSeconds: body.quote.timeEstimate ?? 0,
      originSymbol: origin.originSymbol,
      originChain: origin.originChain,
      destinationSymbol: "USDC",
      destinationChain: "Ethereum",
      recipient,
      depositType: attempt.depositType,
    };
  }
  throw new Error(lastError);
}
