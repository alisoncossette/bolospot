import { apiCall } from '../api-client.js';
import type { Widget } from '../types.js';

export const widgetsResource = {
  uri: 'bolo://widgets',
  name: 'Bolo Permission Categories',
  description: 'All available Bolo permission categories and their scopes.',
  mimeType: 'application/json',
};

export async function readWidgets(): Promise<string> {
  const data = await apiCall<Widget[]>('/grants/widgets');
  return JSON.stringify(data, null, 2);
}
