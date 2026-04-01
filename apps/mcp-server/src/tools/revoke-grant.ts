import { apiCall } from '../api-client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

export const definition: ToolDefinition = {
  name: 'revoke_grant',
  description:
    'Revoke a permission grant you previously gave. Use list_my_grants to find the grant ID.',
  inputSchema: {
    type: 'object',
    properties: {
      grant_id: {
        type: 'string',
        description: 'The ID of the grant to revoke',
      },
    },
    required: ['grant_id'],
  },
};

interface RevokeResponse {
  success: boolean;
  message?: string;
}

export const handler: ToolHandler = async (args) => {
  const grantId = args.grant_id as string;

  const data = await apiCall<RevokeResponse>(`/grants/${grantId}/key`, {
    method: 'DELETE',
  });

  const summary = `Grant ${grantId} has been revoked.`;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ ...data, summary }, null, 2),
    }],
  };
};
