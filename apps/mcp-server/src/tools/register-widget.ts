import { apiCall } from '../api-client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

export const definition: ToolDefinition = {
  name: 'register_widget',
  description:
    'Register a new permission category (widget) in Bolo for your app. ' +
    'This creates a new widget that users can grant access to, just like the built-in calendar or notes widgets. ' +
    'Only the app that registered a widget can modify or deactivate it. ' +
    'Widget slugs must be globally unique, lowercase, and alphanumeric with underscores.',
  inputSchema: {
    type: 'object',
    properties: {
      slug: {
        type: 'string',
        description: 'Unique widget identifier (e.g., "dating", "scheduling"). Lowercase, 2-31 chars.',
      },
      name: {
        type: 'string',
        description: 'Display name (e.g., "Dating", "PT Scheduling")',
      },
      description: {
        type: 'string',
        description: 'What this widget does (e.g., "Simulated dating through agent relay")',
      },
      icon: {
        type: 'string',
        description: 'Emoji or icon (e.g., "💕", "🏥")',
      },
      scopes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Permission scopes for this widget (e.g., ["date:initiate", "date:respond", "profile:share"])',
      },
    },
    required: ['slug', 'name', 'scopes'],
  },
};

export const handler: ToolHandler = async (args) => {
  const data = await apiCall<{ slug: string; name: string; scopes: string[]; createdAt: string }>(
    '/widgets/register',
    {
      method: 'POST',
      body: {
        slug: args.slug as string,
        name: args.name as string,
        description: args.description as string | undefined,
        icon: args.icon as string | undefined,
        scopes: args.scopes as string[],
      },
    },
  );

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...data,
        summary: `Widget "${data.slug}" registered with scopes: ${data.scopes.join(', ')}. Users can now grant access to this widget via Bolo.`,
      }, null, 2),
    }],
  };
};