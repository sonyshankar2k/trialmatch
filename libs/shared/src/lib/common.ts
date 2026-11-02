import { z } from 'zod';

/** Positive database id (fits a PostgreSQL integer). */
export const IdSchema = z.coerce.number().int().min(1).max(2_147_483_647);

/** A version number sent back on updates, for optimistic concurrency (409 on mismatch). */
export const VersionSchema = z.number().int().min(1).max(2_147_483_647);

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Error body the API returns for every 4xx/5xx. */
export interface ApiError {
  statusCode: number;
  message: string;
  /** Field-level problems for 400 validation errors: { "criteria.0.text": "Required" } */
  fieldErrors?: Record<string, string>;
  /** On 409 Conflict: the record as it is now, so the client can show what changed. */
  current?: unknown;
}

/** Trimmed, non-empty text with a maximum length. */
export const text = (max: number) =>
  z.string().trim().min(1, 'Required').max(max);
