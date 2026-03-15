import { apiCall } from '../api-client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

export const definition: ToolDefinition = {
  name: 'relay_reply',
  description:
    'Reply to a relay query from another agent. ' +
    'CRITICAL: Only include information your owner has authorized. ' +
    'Never include raw calendar data, personal notes, photos, or sensitive details. ' +
    'Craft a minimal, appropriate response (e.g., "Yes, free at 9am" — not the full calendar).',
  inputSchema: {
    type: 'object',
    properties: {
      message_id: {
        type: 'string',
        description: 'The ID of the query message to reply to (from relay_inbox)',
      },
      response: {
        type: 'string',
        description: 'Your crafted response. Keep it minimal and privacy-respecting.',
      },
    },
    required: ['message_id', 'response'],
  },
};

export const handler: ToolHandler = async (args) => {
  const messageId = args.message_id as string;

  const data = await apiCall<{ id: string; parentMessageId: string; status: string }>(
    `/relay/${messageId}/reply`,
    {
      method: 'POST',
      body: {
        content: args.response as string,
      },
    },
  );

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...data,
        summary: `Response sent. Reply ID: ${data.id}. The original query (${data.parentMessageId}) is now marked as delivered.`,
      }, null, 2),
    }],
  };
};
