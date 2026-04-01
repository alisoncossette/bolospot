import { apiCall } from '../api-client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

export const definition: ToolDefinition = {
  name: 'deactivate_widget',
  description:
    'Deactivate a widget (permission category) you previously registered. Only the app that registered ' +
    'the widget can deactivate it. Existing grants for this widget will no longer be usable.',
  inputSchema: {
    type: 'object',
    properties: {
      slug: {
        type: 'string',
        description: 'The widget slug to deactivate (e.g., "dating")',
      },
    },
    required: ['slug'],
  },
};

export const handler: ToolHandler = async (args) => {
  const slug = args.slug as string;

  const data = await apiCall<{ slug: string; name: string }>(
    `/widgets/${slug}`,
    { method: 'DELETE' },
  );

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...data,
        summary: `Widget "${slug}" has been deactivated. Existing grants for this widget are no longer usable.`,
      }, null, 2),
    }],
  };
};
