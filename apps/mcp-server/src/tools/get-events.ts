import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

export const definition: ToolDefinition = {
  name: 'get_events',
  description:
    'Get calendar events for yourself or another @handle. Without a handle, returns your own events ' +
    '(titles, times, attendees, locations). With a handle, returns their events (requires events:read grant; ' +
    'descriptions/attendees/locations stripped for privacy, private events show as "Private event").',
  inputSchema: {
    type: 'object',
    properties: {
      handle: {
        type: 'string',
        description: 'The @handle to get events for (e.g., "@sarah"). Omit to get your own events.',
      },
      start_date: {
        type: 'string',
        description: 'Start date in YYYY-MM-DD or ISO 8601 format (e.g., "2026-03-17")',
      },
      end_date: {
        type: 'string',
        description: 'End date in YYYY-MM-DD or ISO 8601 format (e.g., "2026-03-21")',
      },
      timezone: {
        type: 'string',
        description: 'Timezone for date interpretation (e.g., "America/New_York"). Only used when querying another handle.',
      },
    },
    required: ['start_date', 'end_date'],
  },
};

export const handler: ToolHandler = async (args) => {
  const handle = args.handle ? cleanHandle(args.handle as string) : undefined;

  // Other person's events
  if (handle) {
    const data = await apiCall<any>(`/events/${handle}/key`, {
      params: {
        startDate: args.start_date as string,
        endDate: args.end_date as string,
        timezone: args.timezone as string | undefined,
      },
    });

    const events = data.events || [];

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          handle: data.handle || `@${handle}`,
          dateRange: { start: args.start_date, end: args.end_date },
          eventCount: events.length,
          events: events.map((e: any) => ({
            title: e.title,
            start: e.startTime,
            end: e.endTime,
            allDay: e.isAllDay || false,
          })),
          message: events.length > 0
            ? `@${handle} has ${events.length} event(s) in this time range.`
            : `@${handle} has no events in this time range.`,
        }, null, 2),
      }],
    };
  }

  // Own events
  const data = await apiCall<any>('/events/my', {
    params: {
      startDate: args.start_date as string,
      endDate: args.end_date as string,
    },
  });

  const events = data.events || [];

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        eventCount: events.length,
        events: events.map((e: any) => ({
          title: e.title,
          start: e.startTime,
          end: e.endTime,
          location: e.location || null,
          attendees: e.attendees || [],
          calendar: e.calendarName || e.calendarId,
          provider: e.provider,
        })),
        message: events.length > 0
          ? `You have ${events.length} event(s) in this time range.`
          : 'No events found in this time range.',
      }, null, 2),
    }],
  };
};
