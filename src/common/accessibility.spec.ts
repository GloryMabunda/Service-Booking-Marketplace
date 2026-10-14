import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import axe from 'axe-core';
import { JSDOM } from 'jsdom';

// Every page's HTML is checked with axe, the accessibility rules engine, against
// WCAG 2.2 A and AA (spec section 9, #84). The pages are checked as they are
// delivered, before any script fills them: structure, names, labels, language,
// headings, landmarks and ARIA. Colour contrast is checked separately from the
// style tokens (colour-contrast.spec.ts), because it needs real layout.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith('.html') ? [path] : [];
  });
}

const pages = files('public').map((path) => ({
  name: relative('public', path).replace(/\\/g, '/'),
  html: readFileSync(path, 'utf8'),
}));

async function audit(html: string) {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  dom.window.eval(axe.source);
  const result = await (dom.window as unknown as { axe: typeof axe }).axe.run(
    dom.window.document.documentElement,
    {
      runOnly: {
        type: 'tag',
        values: [
          'wcag2a',
          'wcag2aa',
          'wcag21a',
          'wcag21aa',
          'wcag22aa',
          'best-practice',
        ],
      },
      // Needs layout and real styles, which a parsed page does not have
      rules: {
        'color-contrast': { enabled: false },
        'scrollable-region-focusable': { enabled: false },
      },
    },
  );
  dom.window.close();
  return result.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

describe('accessibility of every page (axe, WCAG 2.2 A and AA)', () => {
  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThan(14);
  });

  it.each(pages)(
    '$name has no violations',
    async ({ html }) => {
      expect(await audit(html)).toEqual([]);
    },
    30_000,
  );

  it('would notice a real problem (the checker works)', async () => {
    const broken = `<!doctype html><html><head><title>x</title></head><body>
      <img src="a.png"><input type="text"><button></button><a href="/x"></a></body></html>`;
    const found = (await audit(broken)).join('\n');
    for (const rule of [
      'html-has-lang',
      'image-alt',
      'label',
      'button-name',
      'link-name',
    ]) {
      expect(found, rule).toContain(rule);
    }
  }, 30_000);
});

describe('what the pages promise to people who use a keyboard or a screen reader', () => {
  it.each(pages)(
    '$name starts with a way to the main content, or has little before it',
    ({ name, html }) => {
      // Pages with the shared header offer "Skip to main content" through it;
      // the others have nothing to skip
      const hasSiteHeader = html.includes('<site-header');
      const hasAdminHeader = html.includes('<admin-header');
      if (hasSiteHeader || hasAdminHeader) {
        expect(html, name).toMatch(/<main\b[^>]*id="main"/);
      }
    },
  );

  it('gives each form control a visible label, not only a placeholder', () => {
    for (const { name, html } of pages) {
      const dom = new JSDOM(html);
      const controls = [
        ...dom.window.document.querySelectorAll(
          'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select',
        ),
      ];
      for (const control of controls) {
        const id = control.getAttribute('id');
        const labelled =
          (id && dom.window.document.querySelector(`label[for="${id}"]`)) ||
          control.getAttribute('aria-label') ||
          control.getAttribute('aria-labelledby') ||
          control.closest('label');
        expect(
          Boolean(labelled),
          `${name}: a ${control.tagName.toLowerCase()} with id "${id}" has no label`,
        ).toBe(true);
      }
    }
  });

  it('keeps every id on a page unique, so labels and ARIA point at the right thing', () => {
    for (const { name, html } of pages) {
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(dupes, `${name} repeats ids`).toEqual([]);
    }
  });

  it('lets people zoom: no page blocks pinch-zoom or sets a tiny maximum scale', () => {
    for (const { name, html } of pages) {
      expect(html, name).not.toMatch(/user-scalable\s*=\s*(no|0)/i);
      expect(html, name).not.toMatch(/maximum-scale\s*=\s*[01](\.\d+)?\b/i);
    }
  });
});
