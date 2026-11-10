import { dryQuote } from "@/lib/intents";
import type { OriginId } from "@/lib/origins";
import { resolvePayee, view } from "@/lib/rpc";
import type { PayeeView, VerifyResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { payee?: string; origin?: OriginId };
  try {
    body = (await request.json()) as { payee?: string; origin?: OriginId };
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  if (!body.payee || !body.origin) {
    return Response.json({ error: "Pass payee and origin (near-usdc or ethereum)." }, { status: 400 });
  }
  try {
    const payee = await resolvePayee(body.payee);
    const profile = await view<PayeeView | null>("get_payee", { payee });
    const ethereum = profile?.addresses.find((item) => item.chain === "ethereum");
    if (!ethereum?.current) {
      return Response.json(
        { error: "This payee has no active Ethereum address to pay." },
        { status: 409 },
      );
    }
    const check = await view<VerifyResult>("verify", {
      payee,
      chain: "ethereum",
      address: ethereum.current,
    });
    if (check.status !== "match") {
      return Response.json(
        {
          error: "Refusing to quote. The Ethereum address is not the one Payee Lock currently verifies.",
          verify: check,
        },
        { status: 409 },
      );
    }
    const quote = await dryQuote(body.origin, ethereum.current);
    return Response.json(quote);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quote failed";
    return Response.json({ error: message, simulatedExecution: true }, { status: 502 });
  }
}
