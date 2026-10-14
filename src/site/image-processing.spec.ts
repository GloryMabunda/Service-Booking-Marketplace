import sharp from 'sharp';
import { ApiException } from '../common/api-error.js';
import {
  detectImageType,
  MAX_PHOTO_BYTES,
  processImage,
  thumbSize,
} from './image-processing.js';

const picture = (
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp' = 'jpeg',
) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 60, b: 140 },
    },
  })
    [format]()
    .toBuffer();

async function failure(data: Buffer): Promise<ApiException> {
  try {
    await processImage(data);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiException);
    return error as ApiException;
  }
  throw new Error('expected the photo to be refused');
}

describe('detectImageType', () => {
  it('recognises JPEG, PNG and WebP by their first bytes', async () => {
    expect(detectImageType(await picture(8, 8, 'jpeg'))).toBe('jpeg');
    expect(detectImageType(await picture(8, 8, 'png'))).toBe('png');
    expect(detectImageType(await picture(8, 8, 'webp'))).toBe('webp');
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    ['text', Buffer.from('not an image')],
    ['a GIF', Buffer.from('GIF89a\x01\x00\x01\x00')],
    ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['a PDF', Buffer.from('%PDF-1.4')],
    ['a RIFF that is not WebP', Buffer.from('RIFF\x00\x00\x00\x00WAVEfmt ')],
  ])('refuses %s', (_name, data) => {
    expect(detectImageType(data)).toBeNull();
  });
});

describe('thumbSize', () => {
  it.each([
    [1600, 1067, 480, 320],
    [1067, 1600, 320, 480],
    [1600, 1600, 480, 480],
    [300, 200, 300, 200], // never enlarged
    [480, 480, 480, 480],
    [4000, 10, 480, 1], // never below 1 px
  ])('%i x %i becomes %i x %i', (w, h, tw, th) => {
    expect(thumbSize(w, h)).toEqual({ width: tw, height: th });
  });
});

describe('processImage', () => {
  it('makes a large WebP (1600 px long edge) and a thumbnail (480 px)', async () => {
    const result = await processImage(await picture(3200, 2400));
    const large = await sharp(result.large).metadata();
    const thumb = await sharp(result.thumb).metadata();
    expect(large.format).toBe('webp');
    expect([large.width, large.height]).toEqual([1600, 1200]);
    expect([result.width, result.height]).toEqual([1600, 1200]);
    expect(thumb.format).toBe('webp');
    expect([thumb.width, thumb.height]).toEqual([480, 360]);
  });

  it('keeps a portrait photo in proportion', async () => {
    const result = await processImage(await picture(1200, 3000));
    expect([result.width, result.height]).toEqual([640, 1600]);
    const thumb = await sharp(result.thumb).metadata();
    expect([thumb.width, thumb.height]).toEqual([192, 480]);
  });

  it('never enlarges a small photo', async () => {
    const result = await processImage(await picture(400, 300));
    expect([result.width, result.height]).toEqual([400, 300]);
    const thumb = await sharp(result.thumb).metadata();
    expect([thumb.width, thumb.height]).toEqual([400, 300]);
  });

  it.each(['jpeg', 'png', 'webp'] as const)('accepts a %s', async (format) => {
    const result = await processImage(await picture(100, 100, format));
    expect((await sharp(result.large).metadata()).format).toBe('webp');
  });

  it('turns a photo upright from its camera orientation', async () => {
    // 200 wide, 100 high, marked "rotate 90° to view": shown 100 wide, 200 high
    const sideways = await sharp({
      create: { width: 200, height: 100, channels: 3, background: '#336699' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const result = await processImage(sideways);
    expect([result.width, result.height]).toEqual([100, 200]);
  });

  it('removes all metadata: location, camera and dates', async () => {
    const tagged = await sharp({
      create: { width: 300, height: 200, channels: 3, background: '#336699' },
    })
      .jpeg()
      .withExif({
        IFD0: { Make: 'SecretCameraMaker', Copyright: 'Someone' },
        IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '25/1 45/1 0/1' },
      })
      .toBuffer();
    // The test photo really has metadata before it is processed
    expect((await sharp(tagged).metadata()).exif).toBeDefined();
    expect(tagged.includes(Buffer.from('SecretCameraMaker'))).toBe(true);

    const result = await processImage(tagged);
    for (const data of [result.large, result.thumb]) {
      const meta = await sharp(data).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(data.includes(Buffer.from('SecretCameraMaker'))).toBe(false);
      expect(data.includes(Buffer.from('Copyright'))).toBe(false);
    }
  });

  it('refuses a file that is not an image, by its content and not its name', async () => {
    const error = await failure(Buffer.from('<html>I am a photo.jpg</html>'));
    expect(error.getStatus()).toBe(415);
    expect(error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect((await failure(Buffer.from('GIF89a\x01\x00\x01\x00'))).code).toBe(
      'UNSUPPORTED_FILE_TYPE',
    );
  });

  it('refuses an empty file and a damaged image', async () => {
    expect((await failure(Buffer.alloc(0))).code).toBe('FILE_INVALID');
    const damaged = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from('this is not really a jpeg'),
    ]);
    const error = await failure(damaged);
    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe('FILE_INVALID');
  });

  it('refuses a file over 15 MB', async () => {
    const big = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(MAX_PHOTO_BYTES),
    ]);
    const error = await failure(big);
    expect(error.getStatus()).toBe(413);
    expect(error.code).toBe('FILE_TOO_LARGE');
  });

  it('refuses an image of more than 50 megapixels, even a small file', async () => {
    // 8000 x 6500 = 52 megapixels, plain colour so the file is tiny
    const huge = await sharp({
      create: { width: 8000, height: 6500, channels: 3, background: '#ffffff' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(huge.length).toBeLessThan(MAX_PHOTO_BYTES);
    const error = await failure(huge);
    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe('IMAGE_TOO_LARGE');
  });

  it('accepts an image just under 50 megapixels', async () => {
    const big = await sharp({
      create: { width: 7000, height: 7000, channels: 3, background: '#ffffff' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const result = await processImage(big);
    expect([result.width, result.height]).toEqual([1600, 1600]);
  });
});
