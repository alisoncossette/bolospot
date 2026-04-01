import { apiCall } from '../api-client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

export const definition: ToolDefinition = {
  name: 'relay_ack',
  description:
    'Acknowledge relay messages as delivered. Call this after you have processed messages from ' +
    'relay_inbox or relay_check_responses to mark them as handled.',
  inputSchema: {
    type: 'object',
    properties: {
      message_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of message IDs to acknowledge',
      },
    },
    required: ['message_ids'],
  },
};

export const handler: ToolHandler = async (args) => {
  const messageIds = args.message_ids as string[];

  const data = await apiCall<{ acknowledged: number }>(
    '/relay/ack',
    {
      method: 'POST',
      body: { messageIds },
    },
  );

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...data,
        summary: `Acknowledged ${data.acknowledged} message(s).`,
      }, null, 2),
    }],
  };
};
