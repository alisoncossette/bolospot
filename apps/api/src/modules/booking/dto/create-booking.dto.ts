export class CreateBookingDto {
  startTime: string;
  duration: number;
  timezone: string;
  name: string;
  email: string;
  notes?: string;
  additionalAttendees?: string[];
  additionalHandles?: string[];
  profileSlug?: string;
}
