import { resolvePayee, view } from "@/lib/rpc";
import type { ActivityEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const payeeInput = params.get("payee")?.trim() ?? "";
  const limit = Number(params.get("limit") ?? "40");
  try {
    const payee = payeeInput ? await resolvePayee(payeeInput) : null;
    const events = await view<ActivityEvent[]>("get_activity", {
      payee,
      limit: Number.isFinite(limit) ? limit : 40,
    });
    return Response.json({ events });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load activity";
    return Response.json({ error: message }, { status: 502 });
  }
}
