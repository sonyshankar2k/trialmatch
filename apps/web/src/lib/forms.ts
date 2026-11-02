import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiRequestError } from './api';

/**
 * Puts the API's field errors (400 fieldErrors) onto the form fields.
 * Returns true if any were placed, so the caller can skip a generic message.
 */
export function applyServerErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
): boolean {
  if (!(err instanceof ApiRequestError)) return false;
  const entries = Object.entries(err.fieldErrors);
  for (const [field, message] of entries)
    setError(field as Path<T>, { type: 'server', message });
  return entries.length > 0;
}

/** Number input → number, empty → null (for optional numeric fields). */
export const numberOrNull = (v: unknown) =>
  v === '' || v === null || v === undefined ? null : Number(v);
/** Text input → trimmed string, empty → null (for optional text fields). */
export const textOrNull = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? null : v;
