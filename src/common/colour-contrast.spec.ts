import { readFileSync } from 'node:fs';

// Text can be read by people with low vision (WCAG 2.2 level AA, spec section
// 9, #84): 4.5 to 1 for normal text, 3 to 1 for large text and for the edges
// of controls. The colours are read from the style tokens the site really uses,
// so changing one of them to something too pale fails here.

const tokens = readFileSync('public/css/tokens.css', 'utf8');
const color = (name: string): string => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
  if (!match) throw new Error(`No colour token --${name}`);
  return match[1];
};

function luminance(hex: string): number {
  const channel = (i: number) => {
    const value = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('contrast', () => {
  it('is calculated the way WCAG says', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 1); // the classic "just passes" grey
  });
});

const PAGES = [
  'mbg-white',
  'mbg-tint-blush',
  'mbg-tint-pink',
  'mbg-tint-cream',
  'mbg-tint-lilac',
  'mbg-tint-mint',
];

describe('text on the site’s backgrounds (normal text, 4.5 to 1)', () => {
  it.each(PAGES)('body text (ink) on %s', (bg) => {
    expect(contrast(color('mbg-ink'), color(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(PAGES)('secondary text (muted) on %s', (bg) => {
    expect(contrast(color('mbg-muted'), color(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(PAGES)('links and headings (magenta) on %s', (bg) => {
    expect(contrast(color('mbg-magenta'), color(bg))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it.each(['mbg-white', 'mbg-tint-blush', 'mbg-tint-lilac'])(
    'small pink text (prices, labels) on %s',
    (bg) => {
      expect(
        contrast(color('mbg-pink-text'), color(bg)),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe('text on buttons and badges', () => {
  it.each([
    ['white on a magenta button', '#FFFFFF', 'mbg-magenta'],
    ['white on a magenta button, pressed', '#FFFFFF', 'mbg-magenta-dark'],
    ['dark text on the orange Book button', 'mbg-on-orange', 'mbg-orange'],
    [
      'dark text on the orange Book button, pressed',
      'mbg-on-orange',
      'mbg-orange-dark',
    ],
    ['white on a Confirmed badge', '#FFFFFF', 'mbg-green'],
    ['white on an active chip', '#FFFFFF', 'mbg-magenta'],
  ])('%s', (_name, fg, bg) => {
    const text = fg.startsWith('#') ? fg : color(fg);
    expect(contrast(text, color(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['a Pending badge', '#6E3B00', 'mbg-tint-cream'],
    ['a Completed badge', '#5A1A4A', 'mbg-tint-lilac'],
    ['a No-show badge', 'mbg-error-fg', 'mbg-tint-pink'],
    ['a Cancelled badge', 'mbg-muted', 'mbg-white'],
  ])('%s', (_name, fg, bg) => {
    const text = fg.startsWith('#') ? fg : color(fg);
    expect(contrast(text, color(bg))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('messages', () => {
  it.each(['info', 'success', 'warning', 'error'])(
    '%s text on its tint',
    (kind) => {
      expect(
        contrast(color(`mbg-${kind}-fg`), color(`mbg-${kind}-bg`)),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  // The coloured edge of a message is decoration: the words and the icon carry
  // the meaning, so the edge is not held to the 3 to 1 rule for graphics.
});

describe('large text and edges (3 to 1)', () => {
  it('large pink headings on white', () => {
    expect(
      contrast(color('mbg-pink'), color('mbg-white')),
    ).toBeGreaterThanOrEqual(3);
  });

  it('the border of a form field against white is not too faint to find', () => {
    // Bootstrap's form controls use their own grey border; the focus ring is magenta
    expect(
      contrast(color('mbg-magenta'), color('mbg-white')),
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('the admin calendar colours', () => {
  const source = readFileSync('public/js/admin-calendar.js', 'utf8');
  const looks = [
    ...source.matchAll(
      /(\w+):\s*\{\s*bg:\s*'(#[0-9A-Fa-f]{6})',\s*border:\s*'(#[0-9A-Fa-f]{6})',\s*text:\s*'(#[0-9A-Fa-f]{6})'/g,
    ),
  ];

  it('finds the six statuses', () => {
    expect(looks.map((m) => m[1])).toEqual([
      'pending',
      'confirmed',
      'completed',
      'no_show',
      'cancelled',
      'expired',
    ]);
  });

  it.each([0, 1, 2, 3, 4, 5])(
    'status %i: its text is readable on its colour',
    (index) => {
      const [, status, bg, , text] = looks[index];
      expect(
        contrast(text, bg),
        `${status}: text ${text} on ${bg}`,
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('the blocked-time event is readable too', () => {
    expect(contrast('#4A3A46', '#E8E0E6')).toBeGreaterThanOrEqual(4.5);
  });
});
