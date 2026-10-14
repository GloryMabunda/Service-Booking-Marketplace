import sharp from 'sharp';
import { ApiException } from '../common/api-error.js';

// Website photo processing (BR-16, #106). A photo is accepted only if its own
// bytes say it is a JPEG, PNG or WebP, it is not enormous, and it is then
// re-encoded: turned upright, stripped of all metadata (location, camera,
// dates) and saved as WebP in two sizes. The original upload is never kept.

export const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_PHOTO_PIXELS = 50_000_000; // 50 megapixels
export const LARGE_EDGE = 1600;
export const THUMB_EDGE = 480;

export interface ProcessedImage {
  large: Buffer;
  thumb: Buffer;
  width: number; // of the large version
  height: number;
}

// The type from the file's first bytes, never from its name or claimed type
export function detectImageType(data: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return 'jpeg';
  }
  if (
    data.length >= 8 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

// The size of the thumbnail for a large image: its long edge is 480 px, in the
// same proportions, and a small image is never enlarged
export function thumbSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= THUMB_EDGE) return { width, height };
  const scale = THUMB_EDGE / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const unsupported = () =>
  new ApiException(
    415,
    'UNSUPPORTED_FILE_TYPE',
    'Please upload a JPEG, PNG or WebP photo.',
  );
const invalid = () =>
  new ApiException(
    400,
    'FILE_INVALID',
    "We couldn't read that photo. Please choose a JPEG, PNG or WebP image.",
  );
const tooLarge = () =>
  new ApiException(
    400,
    'IMAGE_TOO_LARGE',
    'This image is more than 50 megapixels. Please upload a smaller version.',
  );

export async function processImage(data: Buffer): Promise<ProcessedImage> {
  if (data.length === 0) throw invalid();
  if (data.length > MAX_PHOTO_BYTES) {
    throw new ApiException(
      413,
      'FILE_TOO_LARGE',
      'That photo is too big. The most you can upload is 15 MB.',
    );
  }
  if (!detectImageType(data)) throw unsupported();

  try {
    // Read the size first, without decoding the picture: a decompression bomb
    // (a small file that expands to a huge image) is refused here
    const info = await sharp(data, { limitInputPixels: false }).metadata();
    if (!info.width || !info.height) throw invalid();
    // A rotated photo has its width and height swapped; the pixel count is the same
    if (info.width * info.height > MAX_PHOTO_PIXELS) throw tooLarge();

    // rotate() with no angle turns the photo upright from its camera
    // orientation. sharp writes no metadata unless asked to, so GPS, camera
    // and date information are gone.
    const base = () =>
      sharp(data, {
        limitInputPixels: MAX_PHOTO_PIXELS,
        animated: false,
      }).rotate();

    const largeResult = await base()
      .resize({
        width: LARGE_EDGE,
        height: LARGE_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumbResult = await base()
      .resize({
        width: THUMB_EDGE,
        height: THUMB_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 78 })
      .toBuffer();

    return {
      large: largeResult.data,
      thumb: thumbResult,
      width: largeResult.info.width,
      height: largeResult.info.height,
    };
  } catch (error) {
    if (error instanceof ApiException) throw error;
    // sharp's own refusal for too many pixels
    if (
      error instanceof Error &&
      /pixel limit|exceeds pixel/i.test(error.message)
    ) {
      throw tooLarge();
    }
    throw invalid();
  }
}
