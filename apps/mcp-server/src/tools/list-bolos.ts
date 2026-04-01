import { apiCall } from '../api-client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

export const definition: ToolDefinition = {
  name: 'list_bolos',
  description:
    'List your bolos (permission grants). Use direction "sent" to see who you\'ve granted access to, ' +
    '"received" to see what access others have given you, or "both" for everything.',
  inputSchema: {
    type: 'object',
    properties: {
      direction: {
        type: 'string',
        enum: ['sent', 'received', 'both'],
        description: 'Which grants to list: "sent" (you gave), "received" (you got), or "both" (default)',
      },
      widget: {
        type: 'string',
        description: 'Filter by widget/category slug (e.g., "calendar", "relay"). Only applies to sent grants.',
      },
    },
  },
};

interface SentGrant {
  id: string;
  granteeHandle: string;
  widget: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
}

interface ReceivedGrant {
  id: string;
  granterHandle: string;
  widget: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
}

export const handler: ToolHandler = async (args) => {
  const direction = (args.direction as string) || 'both';
  const summaryParts: string[] = [];
  const result: Record<string, unknown> = { direction };

  if (direction === 'sent' || direction === 'both') {
    const params: Record<string, string | undefined> = {};
    if (args.widget) params.widget = args.widget as string;

    const sent = await apiCall<SentGrant[]>('/grants/given/key', { params });
    result.sent = sent;

    if (sent.length === 0) {
      summaryParts.push('You have not granted any permissions to other handles.');
    } else {
      const lines = sent.map(g => {
        const expiry = g.expiresAt ? `expires ${g.expiresAt}` : 'no expiry';
        return `  @${g.granteeHandle} — ${g.widget}: ${g.scopes.join(', ')} (${expiry})`;
      });
      summaryParts.push(`Sent ${sent.length} grant(s):\n${lines.join('\n')}`);
    }
  }

  if (direction === 'received' || direction === 'both') {
    const received = await apiCall<ReceivedGrant[]>('/grants/received/key');
    result.received = received;

    if (received.length === 0) {
      summaryParts.push('No one has granted you any permissions yet.');
    } else {
      const lines = received.map(g => {
        const expiry = g.expiresAt ? `expires ${g.expiresAt}` : 'no expiry';
        return `  @${g.granterHandle} — ${g.widget}: ${g.scopes.join(', ')} (${expiry})`;
      });
      summaryParts.push(`Received ${received.length} grant(s):\n${lines.join('\n')}`);
    }
  }

  result.summary = summaryParts.join('\n');

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
};
