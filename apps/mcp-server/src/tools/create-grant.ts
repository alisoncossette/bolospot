import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

export const definition: ToolDefinition = {
  name: 'create_grant',
  description:
    'Grant a @handle or email address access to one of your permission categories. ' +
    'If you provide an email for someone not on Bolo, a pending invite is created and they get a notification. ' +
    'When they sign up, the grant activates automatically. Use list_widgets to see available categories and scopes.',
  inputSchema: {
    type: 'object',
    properties: {
      handle: {
        type: 'string',
        description: 'The @handle to grant access to (e.g., "@sarah"). Provide this or email.',
      },
      email: {
        type: 'string',
        description: 'Email address to grant access to (e.g., "sarah@example.com"). Creates a pending invite if not on Bolo. Provide this or handle.',
      },
      widget: {
        type: 'string',
        description: 'The widget/category slug (e.g., "calendar", "relay")',
      },
      scopes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Permission scopes to grant (e.g., ["read", "book"])',
      },
      note: {
        type: 'string',
        description: 'Optional note about why this grant was created',
      },
      expires_in_days: {
        type: 'number',
        description: 'Number of days until this grant expires (optional, omit for no expiry)',
      },
    },
    required: ['widget', 'scopes'],
  },
};

interface GrantResponse {
  id: string;
  granteeHandle: string | null;
  granteeEmail?: string;
  widget: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
  granteeRegistered: boolean;
  pendingInvite?: boolean;
}

export const handler: ToolHandler = async (args) => {
  const handle = args.handle ? cleanHandle(args.handle as string) : undefined;
  const email = args.email as string | undefined;
  const scopes = args.scopes as string[];
  const widget = args.widget as string;

  if (!handle && !email) {
    return {
      content: [{
        type: 'text',
        text: 'Error: Either "handle" or "email" is required.',
      }],
      isError: true,
    };
  }

  const body: Record<string, unknown> = { widget, scopes };

  if (handle) body.granteeHandle = handle;
  if (email) body.granteeEmail = email;
  if (args.note) body.note = args.note;

  if (args.expires_in_days !== undefined) {
    const days = args.expires_in_days as number;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    body.expiresAt = expiresAt;
  }

  const data = await apiCall<GrantResponse>('/grants/key', {
    method: 'POST',
    body,
  });

  const expiry = data.expiresAt ? `expires ${data.expiresAt}` : 'no expiry';
  const target = data.granteeHandle || data.granteeEmail || email || handle;
  let summary: string;

  if (data.pendingInvite) {
    summary = `Created pending invite for ${target} → ${widget}: ${scopes.join(', ')} (${expiry}). They'll receive an email and the grant activates when they sign up.`;
  } else {
    summary = `Granted ${data.granteeHandle} access to ${widget}: ${scopes.join(', ')} (${expiry}).`;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ ...data, summary }, null, 2),
    }],
  };
};
