export function bigIntToString(value: bigint | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

export function bigIntToNumber(value: bigint | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

export function parseBigIntString(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || value.trim() === '') {
    return null;
  }
  return BigInt(value);
}
