import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler, AvailableSlotsResponse } from '../types.js';

export const definition: ToolDefinition = {
  name: 'get_available_slots',
  description:
    'Get specific bookable time slots for a @handle on a given date. Returns individual slots ' +
    '(e.g., 9:00, 9:30, 10:00) accounting for working hours, buffers, and existing calendar events. ' +
    'More actionable than get_availability when you want to book a meeting.',
  inputSchema: {
    type: 'object',
    properties: {
      handle: {
        type: 'string',
        description: 'The @handle to get slots for (e.g., "@sarah")',
      },
      date: {
        type: 'string',
        description: 'Date in YYYY-MM-DD format (e.g., "2026-02-17")',
      },
      duration: {
        type: 'number',
        description: 'Meeting duration in minutes (must match one of the host\'s allowed durations)',
      },
      timezone: {
        type: 'string',
        description: 'Timezone for results (e.g., "America/New_York")',
      },
      additional_handles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional Bolo @handles for multi-party availability (optional)',
      },
    },
    required: ['handle', 'date', 'duration'],
  },
};

export const handler: ToolHandler = async (args) => {
  const handle = cleanHandle(args.handle as string);
  const additionalHandles = args.additional_handles
    ? (args.additional_handles as string[]).map(cleanHandle).join(',')
    : undefined;

  const data = await apiCall<AvailableSlotsResponse>(`/booking/${handle}/slots`, {
    params: {
      date: args.date as string,
      duration: String(args.duration),
      timezone: args.timezone as string | undefined,
      additionalHandles,
    },
  });

  const available = data.slots?.filter(s => s.available) ?? [];

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...data,
        message: available.length > 0
          ? `Found ${available.length} available slot(s) for @${handle} on ${args.date}.`
          : `No available slots for @${handle} on ${args.date} with ${args.duration}-minute duration.`,
      }, null, 2),
    }],
  };
};
