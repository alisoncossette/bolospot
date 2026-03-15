import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler, HandleExistsResponse } from '../types.js';

export const definition: ToolDefinition = {
  name: 'lookup_handle',
  description:
    'Check if a @handle is registered on Bolo. Returns existence status only — no private information is leaked. ' +
    'Use this to verify a handle before requesting access or booking.',
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
  const data = await apiCall<HandleExistsResponse>(`/@${handle}/exists`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...data,
        message: data.exists
          ? `@${handle} is registered on Bolo.`
          : `@${handle} is not registered on Bolo.${data.claimUrl ? ` Claim it at: ${data.claimUrl}` : ''}`,
      }, null, 2),
    }],
  };
};
