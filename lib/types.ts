export type VerifyStatus = "match" | "no_match" | "pending_change" | "not_registered";

export type AddressView = {
  chain: string;
  current: string | null;
  pending: string | null;
  proposed_by: string | null;
  proposed_at_ms: number | null;
  activates_at_ms: number | null;
  needs_settle: boolean;
};

export type PayeeView = {
  account_id: string;
  display_name: string;
  guardian: string | null;
  delay_seconds: number;
  addresses: AddressView[];
};

export type VerifyResult = {
  status: VerifyStatus;
  payee: string;
  chain: string;
  queried: string;
  current: string | null;
  pending: string | null;
  activates_at_ms: number | null;
  display_name: string | null;
};

export type ActivityEvent = {
  id: number;
  kind: string;
  payee: string;
  chain: string | null;
  address: string | null;
  actor: string;
  at_ms: number;
  activates_at_ms: number | null;
};

export type Lookalike = {
  registered: string;
  prefix: number;
  suffix: number;
};

export type VerifyResponse = VerifyResult & {
  lookalike: Lookalike | null;
  chain_time_ms: number;
};

export type QuoteResponse = {
  simulatedExecution: true;
  dryRun: true;
  label: string;
  correlationId: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  amountInUsd: string;
  amountOutUsd: string;
  timeEstimateSeconds: number;
  originSymbol: string;
  originChain: string;
  destinationSymbol: string;
  destinationChain: string;
  recipient: string;
  depositType: string;
  signature: string;
  timestamp: string;
};
