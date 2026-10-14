import { cleanFilename, detectProofType, sha256 } from './proof-file.js';

describe('detectProofType', () => {
  it('recognises a PDF, a JPEG and a PNG by their first bytes', () => {
    expect(detectProofType(Buffer.from('%PDF-1.7\n...'))).toBe(
      'application/pdf',
    );
    expect(
      detectProofType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])),
    ).toBe('image/jpeg');
    expect(
      detectProofType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
      ),
    ).toBe('image/png');
  });

  it.each([
    ['an empty file', Buffer.alloc(0)],
    ['plain text', Buffer.from('hello')],
    [
      'HTML pretending to be a PDF',
      Buffer.from('<html><script>alert(1)</script>'),
    ],
    ['a GIF', Buffer.from('GIF89a....')],
    ['a Windows program', Buffer.from('MZ\x90\x00\x03')],
    ['a PDF with the signature not at the start', Buffer.from(' %PDF-1.4')],
    ['a truncated PNG signature', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['a truncated JPEG signature', Buffer.from([0xff, 0xd8])],
    ['a ZIP', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  ])('refuses %s', (_name, data) => {
    expect(detectProofType(data)).toBeNull();
  });
});

describe('sha256', () => {
  it('is the 32-byte SHA-256 of the file', () => {
    expect(sha256(Buffer.from('abc')).toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('cleanFilename', () => {
  it.each([
    ['proof.pdf', 'proof.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\Desktop\\payment.png', 'payment.png'],
    ['/tmp/x/receipt.jpg', 'receipt.jpg'],
    ['bad\u0000name\u001f.pdf', 'badname.pdf'],
    ['  spaced.pdf  ', 'spaced.pdf'],
    ['', 'proof'],
    ['   ', 'proof'],
    ['folder/', 'proof'],
    [undefined, 'proof'],
  ])('turns %j into %j', (input, expected) => {
    expect(cleanFilename(input)).toBe(expected);
  });

  it('keeps at most 255 characters', () => {
    expect(cleanFilename('a'.repeat(400) + '.pdf')).toHaveLength(255);
  });
});
