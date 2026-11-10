import deployed from "@/config/deployed.json";

export type DeployedPayee = {
  slug: string;
  accountId: string;
  displayName: string;
  delaySeconds: number;
  guardianAccountId: string;
  addresses: Record<string, string>;
  poison?: { chain: string; address: string; note?: string };
};

export type DeployedConfig = {
  networkId: string;
  rpcUrl: string;
  contractId: string;
  minDelaySeconds: number;
  recommendedDelaySeconds: number;
  demoDelaySeconds: number;
  guardianAccountId: string;
  explorerAccount: string;
  payees: DeployedPayee[];
};

export function getDeployed(): DeployedConfig {
  return {
    ...deployed,
    networkId: process.env.NEAR_NETWORK_ID || deployed.networkId,
    rpcUrl: process.env.NEAR_RPC_URL || deployed.rpcUrl,
    contractId: process.env.CONTRACT_ID || deployed.contractId,
    payees: deployed.payees as DeployedPayee[],
  };
}

export function requireContractId(): string {
  const { contractId } = getDeployed();
  if (!contractId) {
    throw new Error("CONTRACT_ID is empty. Run npm run seed.");
  }
  return contractId;
}
