import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { newStorageKey, StoredFileNotFoundError } from './file-storage.js';
import { LocalFileStorage } from './local-file-storage.js';

describe('LocalFileStorage', () => {
  let root: string;
  let storage: LocalFileStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mbg-storage-'));
    storage = new LocalFileStorage(root);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('saves and reads back the same bytes', async () => {
    const key = newStorageKey();
    const data = Buffer.from([0, 1, 2, 250, 255]);
    await storage.save('private', key, data);
    expect(await storage.read('private', key)).toEqual(data);
  });

  it('keeps the private and public areas apart', async () => {
    const key = newStorageKey();
    await storage.save('private', key, Buffer.from('secret'));
    await expect(storage.read('public', key)).rejects.toBeInstanceOf(
      StoredFileNotFoundError,
    );
    expect(await storage.list('private')).toEqual([key]);
    expect(await storage.list('public')).toEqual([]);
  });

  it('refuses to overwrite a file', async () => {
    const key = newStorageKey();
    await storage.save('private', key, Buffer.from('first'));
    await expect(
      storage.save('private', key, Buffer.from('second')),
    ).rejects.toThrow();
    expect((await storage.read('private', key)).toString()).toBe('first');
  });

  it('deletes a file, and deleting a missing one is fine', async () => {
    const key = newStorageKey();
    await storage.save('private', key, Buffer.from('x'));
    await storage.delete('private', key);
    await expect(storage.read('private', key)).rejects.toBeInstanceOf(
      StoredFileNotFoundError,
    );
    await expect(storage.delete('private', key)).resolves.toBeUndefined();
  });

  it('lists only stored files, not temporary ones', async () => {
    const a = newStorageKey();
    const b = newStorageKey();
    await storage.save('private', a, Buffer.from('a'));
    await storage.save('private', b, Buffer.from('b'));
    expect((await storage.list('private')).sort()).toEqual([a, b].sort());
    // Nothing is left behind by saving
    expect(await readdir(join(root, 'private'))).toHaveLength(2);
  });

  it('lists nothing when the area does not exist yet', async () => {
    expect(await storage.list('public')).toEqual([]);
  });

  it.each([
    '../escape',
    '..\\escape',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    'abc/../../x',
    '',
    'short',
    'UPPERCASEKEYNOTALLOWED00',
    'a'.repeat(200),
    'abcdef0123456789.pdf',
  ])('refuses the key %j before touching the disk', async (key) => {
    await expect(
      storage.save('private', key, Buffer.from('x')),
    ).rejects.toThrow('Invalid storage key');
    await expect(storage.read('private', key)).rejects.toThrow(
      'Invalid storage key',
    );
    await expect(storage.delete('private', key)).rejects.toThrow(
      'Invalid storage key',
    );
  });

  it('refuses an unknown area', async () => {
    await expect(
      storage.save(
        '../private' as 'private',
        newStorageKey(),
        Buffer.from('x'),
      ),
    ).rejects.toThrow('Unknown storage area');
  });

  it('makes random keys that match what storage accepts', () => {
    const keys = new Set(Array.from({ length: 100 }, newStorageKey));
    expect(keys.size).toBe(100);
    for (const key of keys) expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('writes files readable only by the app', async () => {
    const key = newStorageKey();
    await storage.save('private', key, Buffer.from('x'));
    const info = await stat(join(root, 'private', key));
    if (process.platform !== 'win32') {
      expect(info.mode & 0o077).toBe(0);
    }
    expect(info.isFile()).toBe(true);
  });

  it('keeps the default upload folder outside the website folder', () => {
    const website = resolve('public');
    const uploads = resolve('uploads');
    expect(relative(website, uploads).startsWith('..')).toBe(true);
  });
});
