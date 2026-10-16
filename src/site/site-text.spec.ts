import {
  aboutParagraphs,
  isSocialUrl,
  policyText,
  whatsappUrl,
} from './site-text.js';

const settings = {
  depositPercent: '50.00',
  depositHoldHours: 24,
  minNoticeHours: 24,
  maxAdvanceDays: 90,
  depositRefundable: true,
  refundCutoffHours: 24,
};

describe('policyText', () => {
  it('matches the approved example for the reference business', () => {
    expect(policyText(settings)).toEqual([
      "A 50% deposit secures your booking. You'll get banking details by email.",
      'Pay within 24 hours of booking (sooner for appointments in the next two days), or the booking expires and the time is released.',
      'Your booking is confirmed once the deposit reflects in our account.',
      'Book at least 24 hours ahead, and up to 90 days ahead.',
      'Cancel at least 24 hours before your appointment for a full deposit refund.',
    ]);
  });

  it('follows the settings', () => {
    const lines = policyText({
      ...settings,
      depositPercent: '33.50',
      depositHoldHours: 48,
      minNoticeHours: 12,
      maxAdvanceDays: 30,
      refundCutoffHours: 72,
    });
    expect(lines[0]).toContain('A 33.5% deposit');
    expect(lines[1]).toContain('Pay within 48 hours');
    expect(lines[1]).toContain('the next three days');
    expect(lines[3]).toBe(
      'Book at least 12 hours ahead, and up to 30 days ahead.',
    );
    expect(lines[4]).toBe(
      'Cancel at least 72 hours before your appointment for a full deposit refund.',
    );
  });

  it('says deposits are not refundable when they are not', () => {
    const lines = policyText({ ...settings, depositRefundable: false });
    expect(lines.at(-1)).toBe("Deposits aren't refundable.");
    expect(lines.join(' ')).not.toContain('Cancel at least');
  });

  it('leaves the deposit sentences out when no deposit is needed', () => {
    expect(policyText({ ...settings, depositPercent: '0.00' })).toEqual([
      'Book at least 24 hours ahead, and up to 90 days ahead.',
    ]);
  });

  it('copes with no minimum notice', () => {
    expect(
      policyText({ ...settings, depositPercent: '0.00', minNoticeHours: 0 }),
    ).toEqual(['Book up to 90 days ahead.']);
  });

  it('writes a whole 100% deposit without decimals', () => {
    expect(policyText({ ...settings, depositPercent: '100.00' })[0]).toContain(
      'A 100% deposit',
    );
  });
});

describe('aboutParagraphs', () => {
  it('splits at blank lines and trims', () => {
    expect(
      aboutParagraphs("Hi, I'm Sam.\n\nI travel to you.\n\n\n  Book now!  "),
    ).toEqual(["Hi, I'm Sam.", 'I travel to you.', 'Book now!']);
  });

  it('keeps single line breaks inside a paragraph and handles Windows line endings', () => {
    expect(aboutParagraphs('one\r\ntwo\r\n\r\nthree')).toEqual([
      'one\r\ntwo',
      'three',
    ]);
  });

  it('returns nothing for empty text', () => {
    expect(aboutParagraphs('')).toEqual([]);
    expect(aboutParagraphs('  \n\n  ')).toEqual([]);
  });

  it('leaves markup as plain text', () => {
    expect(aboutParagraphs('<script>alert(1)</script>')).toEqual([
      '<script>alert(1)</script>',
    ]);
  });
});

describe('whatsappUrl', () => {
  it('builds a wa.me link without the plus', () => {
    expect(whatsappUrl('+27821234567')).toBe('https://wa.me/27821234567');
  });
});

describe('isSocialUrl', () => {
  it.each([
    ['instagram', 'https://instagram.com/freshstarthome'],
    ['instagram', 'https://www.instagram.com/freshstarthome/'],
    ['facebook', 'https://facebook.com/freshstarthome'],
    ['facebook', 'https://m.facebook.com/freshstarthome'],
    ['tiktok', 'https://www.tiktok.com/@freshstarthome'],
  ] as const)('accepts %s %s', (network, url) => {
    expect(isSocialUrl(network, url)).toBe(true);
  });

  it.each([
    ['instagram', 'http://instagram.com/x'],
    ['instagram', 'https://evil.com/instagram.com'],
    ['instagram', 'https://instagram.com.evil.com/x'],
    ['instagram', 'https://notinstagram.com/x'],
    ['instagram', 'https://user:pass@instagram.com/x'],
    ['instagram', 'javascript:alert(1)'],
    ['instagram', 'instagram.com/x'],
    ['instagram', ''],
    ['facebook', 'https://instagram.com/x'],
    ['tiktok', 'https://tiktok.evil.com'],
  ] as const)('refuses %s %s', (network, url) => {
    expect(isSocialUrl(network, url)).toBe(false);
  });
});
