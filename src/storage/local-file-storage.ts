import {
  link,
  mkdir,
  stat,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  type FileStorage,
  STORAGE_KEY,
  StoredFileNotFoundError,
  type StorageArea,
} from './file-storage.js';

// Keeps files on the local disk: <root>/private/<key> and <root>/public/<key>.
// For development and tests; production uses a private blob store (#67).
// The root folder is never inside public/, which is the website folder, and is
// git-ignored (uploads/).
export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async save(area: StorageArea, key: string, data: Buffer): Promise<void> {
    const path = this.pathOf(area, key);
    await mkdir(join(this.root, area), { recursive: true });
    // Written under a temporary name and then linked into place, so a reader
    // never sees half a file, and link() fails if the key already exists, so a
    // file is never overwritten.
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
    try {
      await link(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async read(area: StorageArea, key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathOf(area, key));
    } catch (error) {
      if (isMissing(error)) throw new StoredFileNotFoundError(area, key);
      throw error;
    }
  }

  async delete(area: StorageArea, key: string): Promise<void> {
    await rm(this.pathOf(area, key), { force: true });
  }

  async list(area: StorageArea): Promise<string[]> {
    try {
      const names = await readdir(join(this.root, area));
      return names.filter((name) => STORAGE_KEY.test(name));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async modifiedAt(area: StorageArea, key: string): Promise<Date | null> {
    try {
      return (await stat(this.pathOf(area, key))).mtime;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private pathOf(area: StorageArea, key: string): string {
    if (area !== 'private' && area !== 'public') {
      throw new Error(`Unknown storage area: ${String(area)}`);
    }
    if (!STORAGE_KEY.test(key)) throw new Error('Invalid storage key');
    return join(this.root, area, key);
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
