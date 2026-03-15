// Bolo API client — thin HTTP layer over the deployed REST API.
// All business logic (grants, anti-spam, rate limits) lives server-side.

const API_BASE_URL = process.env.BOLO_API_URL || 'https://api.bolospot.com';
const API_KEY = process.env.BOLO_API_KEY || '';

export interface ApiCallOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | undefined>;
}

export async function apiCall<T>(
  endpoint: string,
  options: ApiCallOptions = {},
): Promise<T> {
  const { method = 'GET', body, params } = options;

  let url = `${API_BASE_URL}/api${endpoint}`;
  if (params) {
    const filtered = Object.entries(params).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    );
    if (filtered.length > 0) {
      const searchParams = new URLSearchParams(filtered);
      url += `?${searchParams.toString()}`;
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(error);
      message = parsed.message || parsed.error || error;
    } catch {
      message = error;
    }
    throw new Error(`API error (${response.status}): ${message}`);
  }

  return response.json() as T;
}

export function cleanHandle(handle: string): string {
  return handle.replace(/^@/, '').toLowerCase();
}
