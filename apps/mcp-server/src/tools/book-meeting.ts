import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler, BookingResponse } from '../types.js';

export const definition: ToolDefinition = {
  name: 'book_meeting',
  description:
    'Book a meeting with a @handle. The booking tier (direct or approval-required) is determined automatically based on your grants. ' +
    'Use check_booking_tier first to know what to expect. Use get_available_slots to find valid times. ' +
    'If tier is "approval", the host will be notified and must approve before the meeting is confirmed.',
  inputSchema: {
    type: 'object',
    properties: {
      handle: {
        type: 'string',
        description: 'The @handle to book with (e.g., "@sarah")',
      },
      start_time: {
        type: 'string',
        description: 'Meeting start time in ISO 8601 format (e.g., "2026-02-17T10:00:00-05:00")',
      },
      duration: {
        type: 'number',
        description: 'Duration in minutes (must match one of the host\'s allowed durations — check get_booking_profile)',
      },
      timezone: {
        type: 'string',
        description: 'Your timezone (e.g., "America/New_York")',
      },
      name: {
        type: 'string',
        description: 'Your name (the person booking)',
      },
      email: {
        type: 'string',
        description: 'Your email (for calendar invite)',
      },
      notes: {
        type: 'string',
        description: 'Meeting notes or description (optional)',
      },
      additional_handles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional Bolo @handles to include in the meeting (optional)',
      },
      additional_emails: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional email addresses to invite (optional)',
      },
    },
    required: ['handle', 'start_time', 'duration', 'timezone', 'name', 'email'],
  },
};

export const handler: ToolHandler = async (args) => {
  const handle = cleanHandle(args.handle as string);

  const data = await apiCall<BookingResponse>(`/booking/${handle}/book`, {
    method: 'POST',
    body: {
      startTime: args.start_time,
      duration: args.duration,
      timezone: args.timezone,
      name: args.name,
      email: args.email,
      notes: args.notes,
      additionalHandles: args.additional_handles
        ? (args.additional_handles as string[]).map(cleanHandle)
        : undefined,
      additionalAttendees: args.additional_emails,
    },
  });

  const statusMessage = data.status === 'PENDING_APPROVAL'
    ? 'Booking request submitted. The host will be notified and must approve.'
    : 'Meeting confirmed! Calendar invites will be sent.';

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        booking: data,
        message: statusMessage,
      }, null, 2),
    }],
  };
};
