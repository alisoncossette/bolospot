import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

export const definition: ToolDefinition = {
  name: 'relay_send',
  description:
    'Send a query to another person through Bolo\'s trust relay. The query is delivered to their agent. ' +
    'Their raw data never reaches you — only their agent\'s crafted response comes back. ' +
    'You must have the appropriate grant (check with check_access first). ' +
    'Poll relay_check_responses to get the answer.',
  inputSchema: {
    type: 'object',
    properties: {
      handle: {
        type: 'string',
        description: 'The @handle to query (e.g., "@bob")',
      },
      query: {
        type: 'string',
        description: 'Your question or request (e.g., "Is Bob free at 9am Tuesday?")',
      },
      widget: {
        type: 'string',
        description: 'Widget context for the query (e.g., "dating", "scheduling"). Defaults to "relay".',
      },
      scope: {
        type: 'string',
        description: 'Required scope (e.g., "query:send", "date:initiate"). Defaults to "query:send".',
      },
      conversation_id: {
        type: 'string',
        description: 'Optional: continue an existing conversation thread',
      },
    },
    required: ['handle', 'query'],
  },
};

export const handler: ToolHandler = async (args) => {
  const handle = cleanHandle(args.handle as string);

  const data = await apiCall<{ id: string; conversationId?: string; status: string; expiresAt: string }>(
    '/relay/send',
    {
      method: 'POST',
      body: {
        recipientHandle: `@${handle}`,
        content: args.query as string,
        widgetSlug: args.widget as string | undefined,
        scope: args.scope as string | undefined,
        conversationId: args.conversation_id as string | undefined,
      },
    },
  );

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...data,
        summary: `Query sent to @${handle}. Message ID: ${data.id}. Expires: ${data.expiresAt}. Use relay_check_responses to poll for their answer.`,
      }, null, 2),
    }],
  };
};
