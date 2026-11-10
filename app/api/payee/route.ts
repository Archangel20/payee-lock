import { chainTimeMs, resolvePayee, view } from "@/lib/rpc";
import type { PayeeView } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const account = new URL(request.url).searchParams.get("account")?.trim() ?? "";
  if (!account) return Response.json({ error: "Pass account." }, { status: 400 });
  try {
    const payee = await resolvePayee(account);
    const profile = await view<PayeeView | null>("get_payee", { payee });
    if (!profile) return Response.json({ error: `No payee registered for ${payee}` }, { status: 404 });
    const chain_time_ms = await chainTimeMs();
    return Response.json({ ...profile, chain_time_ms });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load payee";
    return Response.json({ error: message }, { status: 502 });
  }
}
