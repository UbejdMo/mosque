import type { Role } from '@mosque/shared';

/**
 * The only way this app talks to the server (SPEC §3). Everything is JSON over
 * the standalone API — there are no web-only endpoints, so a future Expo client
 * reuses this contract verbatim.
 */

const BASE_URL = '/api';

/** Mirrors the API's error envelope: `{ error: { code, message, details? } }`. */
export type ApiErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'internal_error';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      // The session is an httpOnly cookie, so every request must carry it.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    // Offline, or the API is down. Distinguished from an API error so the
    // collector app can say "no signal" rather than "something went wrong".
    throw new ApiError(0, 'internal_error', 'network_unavailable');
  }

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (body as { error?: { code?: ApiErrorCode; message?: string; details?: unknown } })
      ?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'internal_error',
      error?.message ?? response.statusText,
      error?.details,
    );
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
};

export interface SessionUser {
  id: string;
  role: Role;
  mosqueId: string | null;
  householdId: string | null;
}

export const authApi = {
  login: (phone: string, pin: string) =>
    api.post<{ user: SessionUser }>('/auth/login', { phone, pin }),
  logout: () => api.post<void>('/auth/logout'),
  me: () => api.get<{ user: SessionUser }>('/auth/me'),
};
