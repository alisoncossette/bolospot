import * as checkAccess from './check-access.js';
import * as requestAccess from './request-access.js';
import * as listWidgets from './list-widgets.js';
import * as getAvailability from './get-availability.js';
import * as findMutualTime from './find-mutual-time.js';
import * as bookMeeting from './book-meeting.js';
import * as getBookingProfile from './get-booking-profile.js';
import * as lookupHandle from './lookup-handle.js';
import * as relaySend from './relay-send.js';
import * as relayInbox from './relay-inbox.js';
import * as relayReply from './relay-reply.js';
import * as relayCheckResponses from './relay-check-responses.js';
import * as registerWidget from './register-widget.js';
import * as updateWidget from './update-widget.js';
import * as deactivateWidget from './deactivate-widget.js';
import * as relayAck from './relay-ack.js';
import * as updateProfile from './update-profile.js';
import * as listBolos from './list-bolos.js';
import * as createGrant from './create-grant.js';
import * as revokeGrant from './revoke-grant.js';
import * as getEvents from './get-events.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

interface Tool {
  definition: ToolDefinition;
  handler: ToolHandler;
  toolsets: string[];
}

// ─── Toolset assignments ────────────────────────────────
// developer: widget builders integrating with Bolo
// scheduling: end users / agents booking meetings
// account: profile and settings management

export const tools: Tool[] = [
  { ...checkAccess, toolsets: ['developer', 'scheduling'] },
  { ...requestAccess, toolsets: ['developer', 'account'] },
  { ...listWidgets, toolsets: ['developer'] },
  { ...getAvailability, toolsets: ['scheduling'] },
  { ...findMutualTime, toolsets: ['scheduling'] },
  { ...bookMeeting, toolsets: ['scheduling'] },
  { ...getBookingProfile, toolsets: ['scheduling'] },
  { ...lookupHandle, toolsets: ['developer', 'scheduling'] },
  { ...relaySend, toolsets: ['developer'] },
  { ...relayInbox, toolsets: ['developer'] },
  { ...relayReply, toolsets: ['developer'] },
  { ...relayCheckResponses, toolsets: ['developer'] },
  { ...registerWidget, toolsets: ['developer'] },
  { ...updateWidget, toolsets: ['developer'] },
  { ...deactivateWidget, toolsets: ['developer'] },
  { ...relayAck, toolsets: ['developer'] },
  { ...updateProfile, toolsets: ['account'] },
  { ...listBolos, toolsets: ['developer', 'account'] },
  { ...createGrant, toolsets: ['developer'] },
  { ...revokeGrant, toolsets: ['developer'] },
  { ...getEvents, toolsets: ['scheduling'] },
];

// ─── Toolset filtering ─────────────────────────────────

const TOOLSET = (process.env.BOLO_TOOLSET || 'all').toLowerCase();

function getActiveToolsets(): Set<string> {
  if (TOOLSET === 'all' || TOOLSET === '') {
    return new Set(['developer', 'scheduling', 'account']);
  }
  return new Set(TOOLSET.split(',').map(s => s.trim()));
}

const activeToolsets = getActiveToolsets();

export const activeTools: Tool[] = tools.filter(
  t => t.toolsets.some(ts => activeToolsets.has(ts)),
);

// Map for fast lookup by name (only active tools)
export const toolMap = new Map<string, ToolHandler>(
  activeTools.map(t => [t.definition.name, t.handler]),
);
