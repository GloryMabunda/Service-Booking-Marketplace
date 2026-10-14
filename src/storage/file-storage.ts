import { randomBytes } from 'node:crypto';

// Where uploaded files are kept (#67). The rest of the app only knows this
// interface, so the local disk used in development and tests can be replaced
// by a private cloud blob store in production without touching booking logic.
//
// Two areas, both private in storage: the app decides what is served.
//   private  proofs of payment: only an administrator may read them (BR-14)
//   public   website photos: the app serves them from /media/ (BR-16)
export type StorageArea = 'private' | 'public';

export interface FileStorage {
  // Saves the bytes under `key`. Never overwrites: a key is used once.
  save(area: StorageArea, key: string, data: Buffer): Promise<void>;
  // The file's bytes. Throws StoredFileNotFoundError if there is no such file.
  read(area: StorageArea, key: string): Promise<Buffer>;
  // Removes the file. Succeeds quietly if it is already gone.
  delete(area: StorageArea, key: string): Promise<void>;
  // Every key in an area, for the clean-up of orphaned files.
  list(area: StorageArea): Promise<string[]>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

export class StoredFileNotFoundError extends Error {
  constructor(area: StorageArea, key: string) {
    super(`No stored file ${area}/${key}`);
    this.name = 'StoredFileNotFoundError';
  }
}

// A random key for a new file: 256 bits from the secure generator, never
// derived from the filename the client sent, so keys can't be guessed and a
// filename can't be used as a path.
export function newStorageKey(): string {
  return randomBytes(32).toString('hex');
}

// What a valid key looks like. Anything else is refused before it can reach
// the file system, so "../x" or an absolute path can't escape the storage
// folder.
export const STORAGE_KEY = /^[a-f0-9]{16,128}$/;
