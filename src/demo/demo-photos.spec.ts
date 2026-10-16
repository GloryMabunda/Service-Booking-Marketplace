import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  DEMO_HERO,
  DEMO_LOGO,
  DEMO_PHOTO_DIR,
  DEMO_SERVICES,
} from './seed-demo.js';

// The demo's pictures: real, credited, sensibly sized, and nothing left over.

const credits = readFileSync(join(DEMO_PHOTO_DIR, 'CREDITS.md'), 'utf8');
const file = (name: string) => join(DEMO_PHOTO_DIR, name);

describe('the demo photos', () => {
  it.each([...DEMO_SERVICES.map((s) => s.photo), DEMO_HERO])(
    '%s is a proper photo',
    async (name) => {
      const meta = await sharp(file(name)).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.width).toBeGreaterThanOrEqual(800);
      expect(meta.height).toBeGreaterThanOrEqual(500);
      // Small enough to keep the repository and the demo image light
      expect(statSync(file(name)).size).toBeLessThan(300_000);
      // Metadata (location, camera) is removed, as it is for every website photo
      expect(meta.exif).toBeUndefined();
    },
  );

  it.each([...DEMO_SERVICES.map((s) => s.photo), DEMO_HERO])(
    '%s is credited, with its licence',
    (name) => {
      const row = credits
        .split('\n')
        .find((line) => line.includes(`\`${name}\``));
      expect(row, `${name} in CREDITS.md`).toBeDefined();
      expect(row).toMatch(/CC0|CC BY/);
      expect(row).toMatch(/https?:\/\//);
    },
  );

  it('gives each service its own photo, with a description', () => {
    const photos = DEMO_SERVICES.map((s) => s.photo);
    expect(new Set(photos).size).toBe(photos.length);
    for (const service of DEMO_SERVICES) {
      expect(service.alt.length).toBeGreaterThan(10);
    }
  });

  it('has a sample logo with a see-through background', async () => {
    const meta = await sharp(file(DEMO_LOGO)).metadata();
    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBeGreaterThanOrEqual(1200);
    expect(credits).toContain(DEMO_LOGO);
  });

  it('holds nothing that the demo does not use', () => {
    const used = new Set([
      ...DEMO_SERVICES.map((s) => s.photo),
      DEMO_LOGO,
      DEMO_HERO,
      'CREDITS.md',
    ]);
    const stray = readdirSync(DEMO_PHOTO_DIR).filter((name) => !used.has(name));
    expect(stray).toEqual([]);
  });
});
