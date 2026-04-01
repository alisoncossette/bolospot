import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler, AvailabilityResponse, AvailableSlotsResponse } from '../types.js';

export const definition: ToolDefinition = {
  name: 'get_availability',
  description:
    'Get a person\'s availability by their @handle. Without a duration, returns busy periods (any time NOT listed is free). ' +
    'With a duration, returns specific bookable time slots (e.g., 9:00, 9:30) accounting for working hours and buffers. ' +
    'Requires a calendar:free_busy grant from the target — use check_access first.',
  inputSchema: {
    type: 'object',
    properties: {
      handle: {
        type: 'string',
        description: 'The @handle to check (e.g., "@sarah")',
      },
      start_date: {
        type: 'string',
        description: 'Start date in YYYY-MM-DD format (e.g., "2026-02-17")',
      },
      end_date: {
        type: 'string',
        description: 'End date in YYYY-MM-DD format. Required for busy periods mode (no duration). Ignored in slots mode.',
      },
      duration: {
        type: 'number',
        description: 'Meeting duration in minutes. When provided, returns specific bookable time slots for start_date instead of busy periods.',
      },
      timezone: {
        type: 'string',
        description: 'Timezone for results (e.g., "America/New_York"). Defaults to the handle owner\'s timezone.',
      },
      additional_handles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional @handles for multi-party slot availability (only used with duration)',
      },
    },
    required: ['handle', 'start_date'],
  },
};

export const handler: ToolHandler = async (args) => {
  const handle = cleanHandle(args.handle as string);
  const duration = args.duration as number | undefined;

  // Slots mode: duration provided → return bookable time slots
  if (duration !== undefined) {
    const additionalHandles = args.additional_handles
      ? (args.additional_handles as string[]).map(cleanHandle).join(',')
      : undefined;

    const data = await apiCall<AvailableSlotsResponse>(`/booking/${handle}/slots`, {
      params: {
        date: args.start_date as string,
        duration: String(duration),
        timezone: args.timezone as string | undefined,
        additionalHandles,
      },
    });

    const slots = data.slots ?? [];

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          mode: 'slots',
          handle: `@${handle}`,
          ...data,
          message: slots.length > 0
            ? `Found ${slots.length} available slot(s) for @${handle} on ${args.start_date}.`
            : `No available slots for @${handle} on ${args.start_date} with ${duration}-minute duration.`,
        }, null, 2),
      }],
    };
  }

  // Busy periods mode: no duration → return busy/free overview
  if (!args.end_date) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: true, message: 'end_date is required when duration is not provided (busy periods mode).' }),
      }],
      isError: true,
    };
  }

  const data = await apiCall<AvailabilityResponse>(`/availability/${handle}`, {
    params: {
      startDate: args.start_date as string,
      endDate: args.end_date as string,
      timezone: args.timezone as string | undefined,
    },
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        mode: 'busy_periods',
        handle: `@${handle}`,
        dateRange: { start: args.start_date, end: args.end_date },
        timezone: data.timezone,
        busyPeriods: data.busyPeriods,
        message: data.busyPeriods.length > 0
          ? `@${handle} has ${data.busyPeriods.length} busy period(s). Any time not listed is available.`
          : `@${handle} appears to be free for the entire range.`,
      }, null, 2),
    }],
  };
};
