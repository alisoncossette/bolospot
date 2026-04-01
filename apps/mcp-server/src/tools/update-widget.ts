import { apiCall } from '../api-client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

export const definition: ToolDefinition = {
  name: 'update_widget',
  description:
    'Update a widget (permission category) you previously registered. Only the app that registered ' +
    'the widget can update it. Use this to change the name, description, icon, or scopes.',
  inputSchema: {
    type: 'object',
    properties: {
      slug: {
        type: 'string',
        description: 'The widget slug to update (e.g., "dating")',
      },
      name: {
        type: 'string',
        description: 'New display name',
      },
      description: {
        type: 'string',
        description: 'New description',
      },
      icon: {
        type: 'string',
        description: 'New emoji or icon',
      },
      scopes: {
        type: 'array',
        items: { type: 'string' },
        description: 'New permission scopes (replaces existing scopes)',
      },
    },
    required: ['slug'],
  },
};

export const handler: ToolHandler = async (args) => {
  const slug = args.slug as string;
  const body: Record<string, unknown> = {};

  if (args.name !== undefined) body.name = args.name;
  if (args.description !== undefined) body.description = args.description;
  if (args.icon !== undefined) body.icon = args.icon;
  if (args.scopes !== undefined) body.scopes = args.scopes;

  if (Object.keys(body).length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: true, message: 'No fields provided. Specify at least one of: name, description, icon, scopes.' }),
      }],
      isError: true,
    };
  }

  const data = await apiCall<{ slug: string; name: string; scopes: string[] }>(
    `/widgets/${slug}`,
    { method: 'PATCH', body },
  );

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...data,
        summary: `Widget "${slug}" updated. Changed: ${Object.keys(body).join(', ')}.`,
      }, null, 2),
    }],
  };
};
