import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

// The repository ships with no real business's brand (BRANDING.md): the name
// and logo come from the portal, per business. This keeps it that way: no
// hard-coded business name in the pages, scripts or application code, and no
// logo file in public/. Tests may use any name as sample data.

function trackedFiles(): string[] | null {
  try {
    return execFileSync('git', ['ls-files'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return null; // not a git checkout (an exported copy): nothing to check
  }
}

const files = trackedFiles();
const TEXT = new Set(['.html', '.js', '.css', '.ts', '.json']);
const shipped = (files ?? []).filter(
  (f) =>
    (f.startsWith('public/') || f.startsWith('src/')) &&
    TEXT.has(extname(f)) &&
    !f.endsWith('.spec.ts'),
);

// The name of the reference business, however it is spaced or capitalised
const REAL_NAME = /make\s?up\s+by\s+glory/i;
// Her first name, used as the sign-off in emails and in page text
const FIRST_NAME = /\bGlory\b/;

describe.skipIf(!files)('the shipped code carries no real brand', () => {
  it('has files to check', () => {
    expect(shipped.length).toBeGreaterThan(40);
  });

  it('never writes a business name into a page, a script or the application', () => {
    const hits = shipped.filter((f) => REAL_NAME.test(readFileSync(f, 'utf8')));
    expect(hits, 'files with a hard-coded business name').toEqual([]);
  });

  it('never signs an email or a page with a first name', () => {
    const hits = shipped.filter((f) =>
      FIRST_NAME.test(readFileSync(f, 'utf8')),
    );
    expect(hits, 'files with a hard-coded first name').toEqual([]);
  });

  it('holds no logo file: only the neutral favicon', () => {
    const images = (files ?? []).filter(
      (f) =>
        f.startsWith('public/images/') &&
        /\.(png|jpe?g|webp|svg|gif)$/i.test(f),
    );
    expect(images).toEqual(['public/images/brand/favicon-64.png']);
  });

  it('would notice a hard-coded name (the checker works)', () => {
    expect(REAL_NAME.test('© 2026 Make Up by Glory')).toBe(true);
    expect(REAL_NAME.test('MAKEUP BY GLORY')).toBe(true);
    expect(FIRST_NAME.test('See you soon, Glory')).toBe(true);
    expect(REAL_NAME.test('Your Business')).toBe(false);
  });
});
