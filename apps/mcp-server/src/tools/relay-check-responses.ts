import { apiCall } from '../api-client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

export const definition: ToolDefinition = {
  name: 'relay_check_responses',
  description:
    'Check for responses to queries you previously sent via relay_send. ' +
    'Use this to poll for answers after sending a query through the relay.',
  inputSchema: {
    type: 'object',
    properties: {
      since: {
        type: 'string',
        description: 'Optional ISO datetime to only fetch responses after this time',
      },
    },
    required: [],
  },
};

export const handler: ToolHandler = async (args) => {
  const params: Record<string, string | undefined> = {};
  if (args.since) params.since = args.since as string;

  const data = await apiCall<{ messages: any[]; count: number }>(
    '/relay/responses',
    { params },
  );

  let summary: string;
  if (data.count === 0) {
    summary = 'No new responses yet. Try again in a moment.';
  } else {
    const parts = data.messages.map(
      (m: any) => `[${m.id}] from @${m.senderHandle} (re: ${m.parentMessageId}): "${m.content}"`,
    );
    summary = `${data.count} response(s):\n${parts.join('\n')}`;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ ...data, summary }, null, 2),
    }],
  };
};
