import * as checkAccess from './check-access.js';
import * as requestAccess from './request-access.js';
import * as listWidgets from './list-widgets.js';
import * as checkBookingTier from './check-booking-tier.js';
import * as getAvailability from './get-availability.js';
import * as findMutualTime from './find-mutual-time.js';
import * as bookMeeting from './book-meeting.js';
import * as getBookingProfile from './get-booking-profile.js';
import * as getAvailableSlots from './get-available-slots.js';
import * as lookupHandle from './lookup-handle.js';
import * as relaySend from './relay-send.js';
import * as relayInbox from './relay-inbox.js';
import * as relayReply from './relay-reply.js';
import * as relayCheckResponses from './relay-check-responses.js';
import * as registerWidget from './register-widget.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

interface Tool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export const tools: Tool[] = [
  checkAccess,
  requestAccess,
  listWidgets,
  checkBookingTier,
  getAvailability,
  findMutualTime,
  bookMeeting,
  getBookingProfile,
  getAvailableSlots,
  lookupHandle,
  relaySend,
  relayInbox,
  relayReply,
  relayCheckResponses,
  registerWidget,
];

// Map for fast lookup by name
export const toolMap = new Map<string, ToolHandler>(
  tools.map(t => [t.definition.name, t.handler]),
);
