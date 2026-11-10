import { getDeployed, requireContractId } from "@/lib/config";

type RpcResponse<T> = {
  result?: T;
  error?: { message?: string; data?: unknown };
};

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const { rpcUrl } = getDeployed();
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "payee-lock", method, params }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`NEAR RPC ${response.status} from ${rpcUrl}`);
  }
  const body = (await response.json()) as RpcResponse<T>;
  if (body.error) {
    const detail = typeof body.error.data === "string" ? body.error.data : body.error.message;
    throw new Error(detail || "NEAR RPC error");
  }
  if (body.result === undefined) {
    throw new Error(`NEAR RPC ${method} returned no result`);
  }
  return body.result;
}

export async function view<T>(methodName: string, args: Record<string, unknown>): Promise<T> {
  const result = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    account_id: requireContractId(),
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  const text = Buffer.from(result.result).toString("utf8");
  return JSON.parse(text) as T;
}

export async function chainTimeMs(): Promise<number> {
  const block = await rpc<{ header: { timestamp: number } }>("block", { finality: "final" });
  return Number(BigInt(Math.round(block.header.timestamp)) / 1_000_000n);
}

/** Accept a full account id or a display name / slug such as "acme". */
export async function resolvePayee(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Payee is required");
  if (trimmed.includes(".")) return trimmed.toLowerCase();
  const found = await view<Array<{ account_id: string }>>("find_payee", { name: trimmed });
  if (found.length === 1) return found[0].account_id;
  if (found.length === 0) return trimmed.toLowerCase();
  throw new Error(
    `More than one payee matches "${trimmed}": ${found.map((item) => item.account_id).join(", ")}`,
  );
}
