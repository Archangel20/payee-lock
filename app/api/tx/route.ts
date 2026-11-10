import { guardianSigner, missingKeyMessage, relayerSigner, signerForPayee } from "@/lib/keys";
import { callContract } from "@/lib/sign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  action?: string;
  payee?: string;
  chain?: string;
  address?: string;
  displayName?: string;
  guardian?: string;
  delaySeconds?: number;
  addresses?: { chain: string; address: string }[];
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  try {
    if (body.action === "propose") {
      if (!body.payee || !body.chain || !body.address) {
        return Response.json({ error: "propose requires payee, chain, and address." }, { status: 400 });
      }
      const signer = signerForPayee(body.payee);
      if (!signer) return Response.json({ error: missingKeyMessage() }, { status: 503 });
      const tx = await callContract(signer, "propose_address", {
        chain: body.chain,
        new_address: body.address,
      });
      return Response.json({
        ok: true,
        simulated: false,
        action: "propose",
        note: "Signed with the payee account. In the demo this stands in for a stolen owner key. The guardian key is separate.",
        ...tx,
      });
    }
    if (body.action === "veto") {
      if (!body.payee || !body.chain) {
        return Response.json({ error: "veto requires payee and chain." }, { status: 400 });
      }
      const signer = guardianSigner();
      if (!signer) return Response.json({ error: missingKeyMessage() }, { status: 503 });
      const tx = await callContract(signer, "veto", { payee: body.payee, chain: body.chain });
      return Response.json({
        ok: true,
        simulated: false,
        action: "veto",
        note: "Signed with the guardian account. The payee key cannot dismiss this guardian.",
        ...tx,
      });
    }
    if (body.action === "settle") {
      if (!body.payee || !body.chain) {
        return Response.json({ error: "settle requires payee and chain." }, { status: 400 });
      }
      const signer = relayerSigner();
      if (!signer) return Response.json({ error: missingKeyMessage() }, { status: 503 });
      const tx = await callContract(signer, "settle", { payee: body.payee, chain: body.chain });
      return Response.json({ ok: true, simulated: false, action: "settle", ...tx });
    }
    if (body.action === "register") {
      if (!body.payee || !body.displayName || !body.addresses?.length) {
        return Response.json(
          { error: "register requires payee, displayName, and addresses." },
          { status: 400 },
        );
      }
      const signer = signerForPayee(body.payee);
      if (!signer) return Response.json({ error: missingKeyMessage() }, { status: 503 });
      const tx = await callContract(
        signer,
        "register",
        {
          display_name: body.displayName,
          guardian: body.guardian ?? null,
          delay_seconds: body.delaySeconds,
          addresses: body.addresses,
        },
        "0.02",
      );
      return Response.json({ ok: true, simulated: false, action: "register", ...tx });
    }
    return Response.json({ error: "action must be register, propose, veto, or settle." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transaction failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
