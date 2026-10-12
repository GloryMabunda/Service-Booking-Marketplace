import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';

// Every API error has the same shape (docs/api.md section 2):
//   { statusCode, code, message, details }
// `code` is stable for the frontend; `message` is safe to show to people.

export interface FieldProblem {
  field: string;
  message: string;
}

export class ApiException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details: FieldProblem[] | null = null,
    // Extra response headers, e.g. Retry-After on 429.
    readonly headers: Record<string, string> = {},
  ) {
    super({ statusCode: status, code, message, details }, status);
  }
}

// Codes for errors Nest raises itself (unknown route, oversized body, ...).
const DEFAULT_CODES: Record<number, [code: string, message: string]> = {
  400: ['VALIDATION_FAILED', 'Some details are missing or invalid.'],
  401: ['UNAUTHENTICATED', 'Please sign in.'],
  403: ['FORBIDDEN', "You don't have permission to do that."],
  404: ['NOT_FOUND', 'Not found.'],
  413: ['VALIDATION_FAILED', 'The request is too large.'],
  429: ['RATE_LIMITED', 'Too many requests. Please try again later.'],
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ApiException) {
      for (const [name, value] of Object.entries(exception.headers)) {
        res.setHeader(name, value);
      }
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const [code, message] = DEFAULT_CODES[status] ?? [
        'INTERNAL_ERROR',
        'Something went wrong. Please try again.',
      ];
      res
        .status(status)
        .json({ statusCode: status, code, message, details: null });
      return;
    }

    // Unexpected: log the details, never send them.
    this.logger.error(exception instanceof Error ? exception.stack : exception);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      details: null,
    });
  }
}

// Validates a request body with a zod schema, or throws 400 VALIDATION_FAILED
// listing each problem. Use z.strictObject so unknown fields are rejected.
export function parseBody<T extends z.ZodType>(
  schema: T,
  body: unknown,
): z.infer<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    message:
      issue.code === 'unrecognized_keys'
        ? `Unknown field: ${issue.keys.join(', ')}.`
        : issue.message,
  }));
  throw new ApiException(
    400,
    'VALIDATION_FAILED',
    'Some details are missing or invalid.',
    details,
  );
}
