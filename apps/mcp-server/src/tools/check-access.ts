import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler, AccessCheckResponse, BookingTierResponse } from '../types.js';

export const definition: ToolDefinition = {
  name: 'check_access',
  description:
    'Check what a @handle has shared with you on Bolo, including your booking tier. Returns your access ' +
    'across all permission categories (calendar, relay, notes, etc.) and whether you can book directly, ' +
    'need approval, or are blocked. Always check this before other operations.',
  inputSchema: {
    type: 'object',
    properties: {
      handle: {
        type: 'string',
        description: 'The @handle to check access for (e.g., "@sarah")',
      },
    },
    required: ['handle'],
  },
};

export const handler: ToolHandler = async (args) => {
  const handle = cleanHandle(args.handle as string);
  const data = await apiCall<AccessCheckResponse>(`/@${handle}/access/key`);

  // Also fetch booking tier in parallel-style (sequential here but saves the user a tool call)
  let bookingTier: { tier: string; reason: string; explanation: string } | null = null;
  if (data.exists) {
    try {
      const tierData = await apiCall<BookingTierResponse>(`/booking/${handle}/access`);
      const tierExplanation: Record<string, string> = {
        direct: 'You can book directly — the meeting will be confirmed immediately.',
        approval: 'You can book, but the host must approve before the meeting is confirmed.',
        blocked: 'You cannot book with this person.',
      };
      bookingTier = {
        tier: tierData.tier,
        reason: tierData.reason,
        explanation: tierExplanation[tierData.tier] || tierData.tier,
      };
    } catch {
      // Booking tier check is best-effort; don't fail the whole call
    }
  }

  const granted = data.widgets.filter(w => w.status === 'granted');
  const pending = data.pendingRequests.filter(r => r.status === 'PENDING');

  let summary: string;
  if (!data.exists) {
    summary = `@${handle} is not registered on Bolo.`;
  } else if (granted.length === 0) {
    summary = `@${handle} has not shared any access with you.`;
    if (pending.length > 0) {
      summary += ` You have ${pending.length} pending request(s).`;
    }
  } else {
    const parts = granted.map(w => `${w.name}: ${w.scopes.join(', ')}`);
    summary = `@${handle} has shared: ${parts.join(' | ')}`;
  }

  if (bookingTier) {
    summary += ` Booking tier: ${bookingTier.tier}.`;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ ...data, bookingTier, summary }, null, 2),
    }],
  };
};
