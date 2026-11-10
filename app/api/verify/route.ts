import { findLookalike } from "@/lib/lookalike";
import { chainTimeMs, resolvePayee, view } from "@/lib/rpc";
import type { PayeeView, VerifyResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payeeInput = url.searchParams.get("payee")?.trim() ?? "";
  const chain = url.searchParams.get("chain")?.trim() ?? "";
  const address = url.searchParams.get("address")?.trim() ?? "";
  if (!payeeInput || !chain || !address) {
    return Response.json(
      { error: "Pass payee, chain, and address. Example: /api/verify?payee=acme&chain=ethereum&address=0x..." },
      { status: 400 },
    );
  }
  try {
    const payee = await resolvePayee(payeeInput);
    const result = await view<VerifyResult>("verify", { payee, chain, address });
    let registered: string[] = [];
    if (result.status !== "not_registered") {
      const profile = await view<PayeeView | null>("get_payee", { payee: result.payee });
      const slot = profile?.addresses.find((item) => item.chain === result.chain);
      registered = [slot?.current, slot?.pending].filter((item): item is string => Boolean(item));
    }
    const lookalike = result.status === "match" ? null : findLookalike(result.chain, address, registered);
    const chain_time_ms = await chainTimeMs();
    return Response.json({ ...result, lookalike, chain_time_ms });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
