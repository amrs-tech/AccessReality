import type { MutableRefObject } from 'react';

export type PendingCreate = { fingerprint: string; key: string } | null;

// Preserve a create request's key after transport failure so an explicit retry
// can recover the existing job instead of silently creating another one.
export function createRequestKey(ref: MutableRefObject<PendingCreate>, input: unknown) {
  const fingerprint = JSON.stringify(input);
  if (ref.current?.fingerprint !== fingerprint) ref.current = { fingerprint, key: crypto.randomUUID() };
  return ref.current.key;
}
