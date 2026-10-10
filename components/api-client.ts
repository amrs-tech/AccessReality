'use client';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryable = false) { super(message); }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; csrfToken?: string | null; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store', signal: options.signal,
    headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.csrfToken ? { 'X-CSRF-Token': options.csrfToken } : {}) },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data?.error?.code ?? 'request_failed', data?.error?.message ?? 'This request could not be completed. Please try again.', data?.error?.retryable ?? false);
  return data as T;
}

export type Session = { authenticated: boolean; csrfToken: string | null; configured: boolean };
