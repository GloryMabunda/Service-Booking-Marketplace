import { createHash } from 'node:crypto';

// Proof-of-payment files (BR-14, #69). The type comes from the file's own
// first bytes, never from its name or the type the browser claims, because
// both are chosen by whoever uploads.

export const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_PROOFS_PER_BOOKING = 3;

export type ProofContentType = 'application/pdf' | 'image/jpeg' | 'image/png';

const PDF = Buffer.from('%PDF-');
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const startsWith = (data: Buffer, prefix: Buffer) =>
  data.length >= prefix.length &&
  data.subarray(0, prefix.length).equals(prefix);

// The type of an accepted file, or null for anything else
export function detectProofType(data: Buffer): ProofContentType | null {
  if (startsWith(data, PDF)) return 'application/pdf';
  if (startsWith(data, JPEG)) return 'image/jpeg';
  if (startsWith(data, PNG)) return 'image/png';
  return null;
}

export function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

// The name the client's device gave the file, made safe to store and show to
// the owner: no folders, no control characters, at most 255 characters. It is
// only ever displayed, never used as a path (the file is stored under a random
// key).
export function cleanFilename(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'proof').slice(0, 255);
}
