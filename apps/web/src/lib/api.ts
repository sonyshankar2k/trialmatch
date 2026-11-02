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

/**
 * Server-Sent Events over fetch (EventSource can't send an Authorization header).
 * Calls onEvent for each `data:` message until the server ends the stream or `signal` aborts.
 */
export async function streamEvents<T>(
  path: string,
  onEvent: (event: T) => void,
  signal: AbortSignal,
): Promise<void> {
  const token = tokenStore.get();
  const res = await fetch(new URL(`/api${path}`, window.location.origin), {
    headers: {
      Accept: 'text/event-stream',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res
      .json()
      .catch(() => ({ statusCode: res.status, message: res.statusText }));
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiRequestError(res.status, body as ApiError);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const message = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = message
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) onEvent(JSON.parse(data) as T);
    }
  }
}
