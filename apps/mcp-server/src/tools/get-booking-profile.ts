import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler, BookingProfile } from '../types.js';

export const definition: ToolDefinition = {
  name: 'get_booking_profile',
  description:
    'Get a @handle\'s public booking profile. Returns their name, timezone, working hours, ' +
    'available meeting durations, and verification status. ' +
    'Use this before booking to know their available durations and working hours.',
  inputSchema: {
    type: 'object',
    properties: {
      handle: {
        type: 'string',
        description: 'The @handle to look up (e.g., "@sarah")',
      },
    },
    required: ['handle'],
  },
};

export const handler: ToolHandler = async (args) => {
  const handle = cleanHandle(args.handle as string);
  const data = await apiCall<BookingProfile>(`/booking/${handle}/profile`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(data, null, 2),
    }],
  };
};
