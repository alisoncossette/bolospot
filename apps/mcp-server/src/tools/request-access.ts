import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler, AccessRequestResponse } from '../types.js';

export const definition: ToolDefinition = {
  name: 'request_access',
  description:
    'Request access to a @handle\'s Bolo permission category. The target receives your request and can approve or decline. ' +
    'Anti-spam protections apply: duplicate requests are blocked, declined requests have a 7-day cooldown, ' +
    'and you are limited to 10 requests per hour. ' +
    'Use list_widgets first to see available categories and scopes.',
  inputSchema: {
    type: 'object',
    properties: {
      handle: {
        type: 'string',
        description: 'The @handle to request access from (e.g., "@sarah")',
      },
      widget: {
        type: 'string',
        description: 'Permission category to request (e.g., "calendar", "calendly", "notes")',
      },
      scopes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific scopes to request (e.g., ["free_busy", "events:create"])',
      },
      reason: {
        type: 'string',
        description: 'Why you need access — shown to the target (optional but recommended)',
      },
      agent_name: {
        type: 'string',
        description: 'Name of the AI agent making the request (e.g., "Claude", "OpenClaw")',
      },
    },
    required: ['handle', 'widget', 'scopes'],
  },
};

export const handler: ToolHandler = async (args) => {
  const handle = cleanHandle(args.handle as string);
  const data = await apiCall<AccessRequestResponse>(`/@${handle}/request`, {
    method: 'POST',
    body: {
      widget: args.widget,
      scopes: args.scopes,
      reason: args.reason,
      agentName: args.agent_name,
    },
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(data, null, 2),
    }],
  };
};
