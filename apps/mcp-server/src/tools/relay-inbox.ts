import { apiCall } from '../api-client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

export const definition: ToolDefinition = {
  name: 'relay_inbox',
  description:
    'Check for incoming relay queries from other agents. Returns pending queries addressed to you. ' +
    'Use relay_reply to respond to each query. ' +
    'IMPORTANT: Your owner\'s raw data stays local — only send crafted, minimal responses.',
  inputSchema: {
    type: 'object',
    properties: {
      since: {
        type: 'string',
        description: 'Optional ISO datetime to only fetch messages after this time',
      },
    },
    required: [],
  },
};

export const handler: ToolHandler = async (args) => {
  const params: Record<string, string | undefined> = {};
  if (args.since) params.since = args.since as string;

  const data = await apiCall<{ messages: any[]; count: number }>(
    '/relay/inbox',
    { params },
  );

  let summary: string;
  if (data.count === 0) {
    summary = 'No pending queries in your inbox.';
  } else {
    const parts = data.messages.map(
      (m: any) => `[${m.id}] from @${m.senderHandle}: "${m.content}"`,
    );
    summary = `${data.count} pending query(ies):\n${parts.join('\n')}`;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ ...data, summary }, null, 2),
    }],
  };
};
