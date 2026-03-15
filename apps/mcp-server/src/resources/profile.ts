import { apiCall } from '../api-client.js';
import type { BookingProfile } from '../types.js';

export const profileResourceTemplate = {
  uriTemplate: 'bolo://profile/{handle}',
  name: 'Booking Profile for @{handle}',
  description: 'Public booking profile including working hours and available durations.',
  mimeType: 'application/json',
};

export async function readProfile(handle: string): Promise<string> {
  const data = await apiCall<BookingProfile>(`/booking/${handle}/profile`);
  return JSON.stringify(data, null, 2);
}
