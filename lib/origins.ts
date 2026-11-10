export const ORIGINS = [
  {
    id: "near-usdc",
    title: "10 USDC from NEAR",
    detail: "USDC on NEAR, delivered as USDC on Ethereum",
    originAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    amount: "10000000",
    originSymbol: "USDC",
    originChain: "NEAR",
    refundTo: "wrap.near",
  },
  {
    id: "ethereum",
    title: "0.01 ETH from Ethereum",
    detail: "ETH on Ethereum, delivered as USDC on Ethereum",
    originAsset: "nep141:eth.omft.near",
    amount: "10000000000000000",
    originSymbol: "ETH",
    originChain: "Ethereum",
    refundTo: "",
  },
] as const;

export type OriginId = (typeof ORIGINS)[number]["id"];
