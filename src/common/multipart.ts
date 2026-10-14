import type { Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { ApiException } from './api-error.js';

// Reads uploaded files from a multipart/form-data request, in memory, with
// each file capped in size while it streams in. Used by the photo uploads
// (BR-16); proof uploads have their own, stricter reader.

export interface MultipartOptions {
  // The form field that carries the file(s)
  field: string;
  // How many files at most
  maxFiles: number;
  // The most one file may weigh, in bytes
  maxBytes: number;
  // How many other (text) fields are allowed
  maxFields: number;
}

export interface ReceivedMultipart {
  files: Express.Multer.File[];
  fields: Record<string, string>;
}

export async function receiveMultipart(
  req: Request,
  res: Response,
  options: MultipartOptions,
): Promise<ReceivedMultipart> {
  const reader = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: options.maxBytes,
      files: options.maxFiles,
      fields: options.maxFields,
      parts: options.maxFiles + options.maxFields,
      // Names and values of text fields are short here
      fieldSize: 2_000,
    },
  }).array(options.field, options.maxFiles);

  try {
    await new Promise<void>((resolve, reject) => {
      reader(req, res, (error: unknown) => {
        if (!error) resolve();
        else
          reject(
            error instanceof Error
              ? error
              : new Error('Upload failed', { cause: error }),
          );
      });
    });
  } catch (error) {
    throw uploadProblem(error);
  }
  return {
    files: (req.files as Express.Multer.File[] | undefined) ?? [],
    fields: (req.body ?? {}) as Record<string, string>,
  };
}

function uploadProblem(error: unknown): ApiException {
  if (error instanceof MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return new ApiException(
        413,
        'FILE_TOO_LARGE',
        'That photo is too big. The most you can upload is 15 MB.',
      );
    }
    // More files than allowed, or a file in the wrong field
    if (
      error.code === 'LIMIT_UNEXPECTED_FILE' ||
      error.code === 'LIMIT_FILE_COUNT'
    ) {
      return new ApiException(
        400,
        'FILE_MISSING',
        'Choose between 1 and 10 photos to upload.',
      );
    }
  }
  return new ApiException(
    400,
    'FILE_INVALID',
    "We couldn't read that upload. Please try again.",
  );
}
