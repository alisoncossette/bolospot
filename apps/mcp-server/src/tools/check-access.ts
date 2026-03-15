import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler, AccessCheckResponse } from '../types.js';

export const definition: ToolDefinition = {
  name: 'check_access',
  description:
    'Check what a @handle has shared with you on Bolo. Returns your access across all permission categories (calendar, calendly, notes). ' +
    'Always check access before attempting other operations like get_availability or book_meeting. ' +
    'If you lack access, use request_access to ask for it.',
  inputSchema: {
    type: 'object',
    properties: {
      handle: {
        type: 'string',
        description: 'The @handle to check access for (e.g., "@sarah")',
      },
    },
    required: ['handle'],
  },
};

export const handler: ToolHandler = async (args) => {
  const handle = cleanHandle(args.handle as string);
  const data = await apiCall<AccessCheckResponse>(`/@${handle}/access/key`);

  // Build a human-readable summary alongside the raw data
  const granted = data.widgets.filter(w => w.status === 'granted');
  const pending = data.pendingRequests.filter(r => r.status === 'PENDING');

  let summary: string;
  if (!data.exists) {
    summary = `@${handle} is not registered on Bolo.`;
  } else if (granted.length === 0) {
    summary = `@${handle} has not shared any access with you.`;
    if (pending.length > 0) {
      summary += ` You have ${pending.length} pending request(s).`;
    }
  } else {
    const parts = granted.map(w => `${w.name}: ${w.scopes.join(', ')}`);
    summary = `@${handle} has shared: ${parts.join(' | ')}`;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ ...data, summary }, null, 2),
    }],
  };
};
