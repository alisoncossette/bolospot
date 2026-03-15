import { apiCall } from '../api-client.js';
import type { ToolDefinition, ToolHandler, Widget } from '../types.js';

export const definition: ToolDefinition = {
  name: 'list_widgets',
  description:
    'List all available Bolo permission categories and their scopes. ' +
    'Use this to understand what types of access can be requested or granted. ' +
    'Categories include calendar (availability, events), calendly (scheduling links), and notes.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export const handler: ToolHandler = async () => {
  const data = await apiCall<Widget[]>('/grants/widgets');

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        widgets: data,
        summary: data.map(w => `${w.name} (${w.slug}): ${w.scopes.join(', ')}`).join('\n'),
      }, null, 2),
    }],
  };
};
