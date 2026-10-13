import type request from 'supertest';

// The error shape from docs/api.md section 2.
export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details: { field: string; message: string }[] | null;
}

// A response body with the type the test expects (supertest types it any).
export function bodyOf<T>(res: request.Response): T {
  return res.body as T;
}

export const errorBody = (res: request.Response) => bodyOf<ErrorBody>(res);
