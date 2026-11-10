export type Signer = { accountId: string; privateKey: string };

const PAYEE_ENV = ["ACME", "GLOBEX", "INITECH"] as const;

export function signerForPayee(accountId: string): Signer | null {
  for (const name of PAYEE_ENV) {
    const id = process.env[`${name}_ACCOUNT_ID`];
    const key = process.env[`${name}_PRIVATE_KEY`];
    if (id && key && id === accountId) return { accountId: id, privateKey: key };
  }
  return null;
}

export function guardianSigner(): Signer | null {
  const accountId = process.env.GUARDIAN_ACCOUNT_ID;
  const privateKey = process.env.GUARDIAN_PRIVATE_KEY;
  if (!accountId || !privateKey) return null;
  return { accountId, privateKey };
}

export function relayerSigner(): Signer | null {
  return guardianSigner();
}

export function missingKeyMessage(): string {
  return "This server has no demo signing keys. From the repo root run npm run seed, then restart npm run dev. Reads do not need keys.";
}
