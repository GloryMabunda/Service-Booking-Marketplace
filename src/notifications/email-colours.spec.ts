import { EMAIL_COLOURS as C } from './email-colours.js';
import { renderEmail } from './email-layout.js';

// WCAG contrast between two #RRGGBB colours
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe('the email colours', () => {
  it.each([
    ['body text on white', C.ink, '#FFFFFF'],
    ['labels and the footer on white', C.muted, '#FFFFFF'],
    ['links and headings on white', C.primary, '#FFFFFF'],
    ['text on the notice box', C.ink, C.callout],
    ['text on the button', C.onAction, C.action],
  ])('%s is easy to read (WCAG AA, 4.5:1)', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('are the colours the emails are drawn with', () => {
    const { html } = renderEmail(
      'Subject',
      [
        { callout: 'Not confirmed yet' },
        { button: { label: 'Open', url: 'https://example.com' } },
        { rows: [['When', 'Today']] },
      ],
      ['Fresh Start'],
    );
    for (const colour of [C.ink, C.primary, C.action, C.callout, C.muted]) {
      expect(html).toContain(colour);
    }
    // Nothing is left of the old magenta look
    expect(html).not.toMatch(/A02080|2A1A26|faf2f8/i);
  });
});
