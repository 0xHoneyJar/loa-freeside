const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Lowercase EVM address — matches score-api / sonar-api kitchen normalization. */
export function normalizeContractAddress(address: string): string | null {
  const trimmed = address.trim();
  if (!EVM_ADDRESS_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function normalizeChainId(chainId: string): string | null {
  const trimmed = chainId.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return trimmed;
}
