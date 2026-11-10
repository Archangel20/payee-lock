export const CHAINS: { id: string; label: string }[] = [
  { id: "ethereum", label: "Ethereum" },
  { id: "base", label: "Base" },
  { id: "arbitrum", label: "Arbitrum" },
  { id: "polygon", label: "Polygon" },
  { id: "near", label: "NEAR" },
  { id: "solana", label: "Solana" },
  { id: "bitcoin", label: "Bitcoin" },
];

export function chainLabel(chain: string): string {
  return CHAINS.find((item) => item.id === chain)?.label ?? chain;
}

export function eventLabel(kind: string): string {
  switch (kind) {
    case "payee_registered":
      return "Registered receiving addresses";
    case "address_proposed":
      return "Proposed an address change";
    case "address_vetoed":
      return "Vetoed a pending change";
    case "address_activated":
      return "A delayed change became active";
    case "guardian_set":
      return "Guardian updated";
    default:
      return kind;
  }
}
