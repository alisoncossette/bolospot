import { apiCall } from '../api-client.js';
import type { AccessCheckResponse } from '../types.js';

export const accessResourceTemplate = {
  uriTemplate: 'bolo://access/{handle}',
  name: 'Access Map for @{handle}',
  description: 'Shows what a @handle has shared with you across all permission categories.',
  mimeType: 'application/json',
};

export async function readAccess(handle: string): Promise<string> {
  const data = await apiCall<AccessCheckResponse>(`/@${handle}/access/key`);
  return JSON.stringify(data, null, 2);
}
