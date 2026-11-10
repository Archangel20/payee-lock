import { view } from "@/lib/rpc";
import type { PayeeView } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payees = await view<PayeeView[]>("get_payees", {});
    return Response.json({ payees });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list payees";
    return Response.json({ error: message, payees: [] }, { status: 502 });
  }
}
