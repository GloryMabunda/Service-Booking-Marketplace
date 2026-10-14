import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { policyFor } from './security-headers.js';

// Every page of the site is written so the content policy (#85) and the
// privacy rules (spec section 9) can hold: no code in the page itself, outside
// scripts pinned to one exact version and checked by an integrity hash, and
// nothing from a host the policy doesn't allow.

function files(dir: string, extension: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, extension);
    return path.endsWith(extension) ? [path] : [];
  });
}

const pages = files('public', '.html').map((path) => ({
  name: relative('public', path).replace(/\\/g, '/'),
  html: readFileSync(path, 'utf8'),
}));

const tags = (html: string, tag: string) =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
const attr = (tag: string, name: string) =>
  new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag)?.[1];

describe('the pages of the site', () => {
  it('finds the pages, so the checks below are not empty', () => {
    expect(pages.length).toBeGreaterThan(10);
    expect(pages.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        'index.html',
        'booking.html',
        'admin/index.html',
        'admin/website.html',
      ]),
    );
  });

  describe.each(pages)('$name', ({ name, html }) => {
    it('has no script written in the page itself', () => {
      for (const tag of tags(html, 'script')) {
        expect(
          attr(tag, 'src'),
          `an inline script in ${name}: ${tag}`,
        ).toBeDefined();
      }
      // and nothing written between a script tag and its end
      for (const match of html.matchAll(
        /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi,
      )) {
        expect(match[1].trim(), `code inside a script tag in ${name}`).toBe('');
      }
    });

    it('has no inline event handlers or javascript: links', () => {
      expect(html).not.toMatch(/\son[a-z]+\s*=\s*["']/i);
      expect(html).not.toMatch(/(?:href|src|action)\s*=\s*["']\s*javascript:/i);
    });

    it('takes outside scripts and styles only from allowed hosts, pinned and checked', () => {
      const outside = [...tags(html, 'script'), ...tags(html, 'link')].filter(
        (tag) => /(?:src|href)="https?:\/\//i.test(tag),
      );
      for (const tag of outside) {
        const url = (attr(tag, 'src') ?? attr(tag, 'href')) as string;
        expect(['cdn.jsdelivr.net'], url).toContain(new URL(url).hostname);
        // One exact version, never "latest" or a range
        expect(url, url).toMatch(/@\d+\.\d+\.\d+\//);
        expect(attr(tag, 'integrity'), `${url} has an integrity hash`).toMatch(
          /^sha(256|384|512)-/,
        );
        expect(
          attr(tag, 'crossorigin'),
          `${url} is fetched without credentials`,
        ).toBe('anonymous');
      }
    });

    it('is a complete page: language, title, viewport and a main area', () => {
      expect(html).toMatch(/<html lang="en"/);
      expect(html).toMatch(/<title>[^<]+<\/title>/);
      expect(html).toMatch(
        /<meta name="viewport" content="width=device-width, initial-scale=1"/,
      );
      expect(html).toMatch(/<main\b[^>]*id="main"/);
    });

    it('does not use markup or links to other sites the policy forbids', () => {
      expect(html).not.toMatch(
        /<(iframe|object|embed|form\s+[^>]*action="https?:)/i,
      );
      expect(html).not.toMatch(/<base\b/i);
    });
  });

  it('keeps the private booking page free of third-party scripts', () => {
    const booking = pages.find((p) => p.name === 'booking.html')!;
    for (const tag of tags(booking.html, 'script')) {
      expect(attr(tag, 'src')).toMatch(/^\//);
    }
    expect(booking.html).toContain(
      '<meta name="referrer" content="no-referrer"',
    );
    expect(booking.html).toContain('<meta name="robots" content="noindex"');
  });

  it('keeps every page that holds personal data out of search engines', () => {
    const hidden = pages.filter((p) =>
      /^(admin\/|lookup|booking|book-details)/.test(p.name),
    );
    expect(hidden.length).toBeGreaterThan(8);
    for (const page of hidden) {
      expect(page.html, page.name).toContain(
        '<meta name="robots" content="noindex"',
      );
    }
  });
});

describe('what the site loads from other hosts', () => {
  // Hosts used by the stylesheets and pages, found by reading them
  const hosts = new Set<string>();
  for (const path of [
    ...files('public', '.html'),
    ...files('public', '.css'),
    ...files('public', '.js'),
  ]) {
    for (const match of readFileSync(path, 'utf8').matchAll(
      /https?:\/\/([a-z0-9.-]+)/gi,
    )) {
      hosts.add(match[1].toLowerCase());
    }
  }
  // Hosts that appear only in text or as links the owner follows, not as loaded files
  const LINKS_ONLY = new Set([
    'wa.me',
    'www.w3.org',
    'instagram.com',
    'localhost',
    'example.com',
  ]);

  it('are all ones the content policy allows', () => {
    const policy = policyFor('/') as string;
    for (const host of hosts) {
      if (LINKS_ONLY.has(host)) continue;
      expect(
        policy,
        `${host} is used by the site but not allowed by the content policy`,
      ).toContain(host);
    }
  });

  it('are known: a new outside host has to be added here on purpose', () => {
    const known = ['cdn.jsdelivr.net', 'fonts.googleapis.com'];
    const loaded = [...hosts].filter((h) => !LINKS_ONLY.has(h)).sort();
    expect(loaded).toEqual(known.sort());
  });
});
