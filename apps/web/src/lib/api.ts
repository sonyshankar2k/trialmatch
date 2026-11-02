import type { ApiError } from '@trialmatch/shared';

/** Thrown for any non-2xx response; carries the API's error body. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }
  get fieldErrors(): Record<string, string> {
    return this.body.fieldErrors ?? {};
  }
}

const TOKEN_KEY = 'trialmatch.token';
let onUnauthorized: () => void = () => undefined;

export const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (token: string) => sessionStorage.setItem(TOKEN_KEY, token),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

/** Called when a signed-in request gets 401 (expired token): the app signs out. */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

type Query = Record<string, string | number | undefined | null>;

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Query } = {},
): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined && v !== null && v !== '')
      url.searchParams.set(k, String(v));
  }
  const token = tokenStore.get();
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const body = await res
    .json()
    .catch(() => ({ statusCode: res.status, message: res.statusText }));
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiRequestError(res.status, body as ApiError);
  }
  return body as T;
}

/** A message a person can act on, for toasts and banners. */
export function errorMessage(
  err: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (err instanceof ApiRequestError) return err.body.message || fallback;
  if (err instanceof TypeError)
    return 'Cannot reach the server. Check your connection and try again.';
  return fallback;
}
