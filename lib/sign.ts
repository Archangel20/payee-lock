import { Account, JsonRpcProvider, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { getDeployed } from "@/lib/config";
import type { Signer } from "@/lib/keys";

type TxOutcome = {
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
};

export async function callContract(
  signer: Signer,
  methodName: string,
  args: Record<string, unknown>,
  depositNear: `${number}` = "0",
): Promise<{ transactionId: string | null }> {
  const { rpcUrl, contractId } = getDeployed();
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const account = new Account(signer.accountId, provider, signer.privateKey as KeyPairString);
  const outcome = (await account.callFunctionRaw({
    contractId,
    methodName,
    args,
    gas: teraToGas(80),
    deposit: nearToYocto(depositNear),
  })) as TxOutcome;
  return {
    transactionId: outcome.transaction?.hash ?? outcome.transaction_outcome?.id ?? null,
  };
}
