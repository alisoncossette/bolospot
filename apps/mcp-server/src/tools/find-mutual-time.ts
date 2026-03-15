import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler, MutualAvailabilityResponse } from '../types.js';

export const definition: ToolDefinition = {
  name: 'find_mutual_time',
  description:
    'Find time slots when multiple people are all available. Requires calendar:free_busy grants from ALL listed handles. ' +
    'Use this to coordinate group meetings. Check access with each person first.',
  inputSchema: {
    type: 'object',
    properties: {
      handles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of @handles to find mutual availability (e.g., ["@sarah", "@mike"])',
      },
      duration: {
        type: 'number',
        description: 'Meeting duration in minutes (e.g., 30)',
      },
      start_date: {
        type: 'string',
        description: 'Start of date range in YYYY-MM-DD format',
      },
      end_date: {
        type: 'string',
        description: 'End of date range in YYYY-MM-DD format',
      },
      timezone: {
        type: 'string',
        description: 'Timezone for results (e.g., "America/New_York")',
      },
    },
    required: ['handles', 'duration', 'start_date', 'end_date'],
  },
};

export const handler: ToolHandler = async (args) => {
  const handles = (args.handles as string[]).map(cleanHandle);

  const data = await apiCall<MutualAvailabilityResponse>('/availability/mutual', {
    params: {
      handles: handles.join(','),
      startDate: args.start_date as string,
      endDate: args.end_date as string,
      duration: String(args.duration),
      timezone: args.timezone as string | undefined,
    },
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        handles: handles.map(h => `@${h}`),
        duration: args.duration,
        dateRange: { start: args.start_date, end: args.end_date },
        timezone: data.timezone,
        mutualSlots: data.mutualSlots,
        message: data.mutualSlots.length > 0
          ? `Found ${data.mutualSlots.length} time(s) when all ${handles.length} people are available.`
          : `No mutual availability found for the given date range and duration.`,
      }, null, 2),
    }],
  };
};
