import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler, AvailabilityResponse } from '../types.js';

export const definition: ToolDefinition = {
  name: 'get_availability',
  description:
    'Get a person\'s busy times by their @handle. Returns busy periods across all their connected calendars ' +
    '(Google, Microsoft, Apple). Any time NOT listed as busy is available. ' +
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
        description: 'End date in YYYY-MM-DD format (e.g., "2026-02-21")',
      },
      timezone: {
        type: 'string',
        description: 'Timezone for results (e.g., "America/New_York"). Defaults to the handle owner\'s timezone.',
      },
    },
    required: ['handle', 'start_date', 'end_date'],
  },
};

export const handler: ToolHandler = async (args) => {
  const handle = cleanHandle(args.handle as string);

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
