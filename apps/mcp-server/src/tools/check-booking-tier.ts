import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler, BookingTierResponse } from '../types.js';

export const definition: ToolDefinition = {
  name: 'check_booking_tier',
  description:
    'Check what booking tier you get for a @handle. Returns "direct" (can book immediately), ' +
    '"approval" (host must approve before meeting is confirmed), or "blocked" (cannot book). ' +
    'Check this before attempting to book a meeting.',
  inputSchema: {
    type: 'object',
    properties: {
      handle: {
        type: 'string',
        description: 'The @handle to check booking access for (e.g., "@sarah")',
      },
    },
    required: ['handle'],
  },
};

export const handler: ToolHandler = async (args) => {
  const handle = cleanHandle(args.handle as string);
  const data = await apiCall<BookingTierResponse>(`/booking/${handle}/access`);

  const tierExplanation: Record<string, string> = {
    direct: 'You can book directly — the meeting will be confirmed immediately.',
    approval: 'You can book, but the host must approve before the meeting is confirmed.',
    blocked: 'You cannot book with this person.',
  };

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...data,
        explanation: tierExplanation[data.tier] || data.tier,
      }, null, 2),
    }],
  };
};
