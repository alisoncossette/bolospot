import { apiCall, cleanHandle } from '../api-client.js';
import type { ToolDefinition, ToolHandler, BookingResponse, HandleExistsResponse } from '../types.js';

export const definition: ToolDefinition = {
  name: 'book_meeting',
  description:
    'Book a meeting with a @handle or email address. If the person has a Bolo @handle, use that. ' +
    'If they don\'t have a handle, provide their email and the meeting invite will be sent via email ' +
    'with a link to claim their @handle on Bolo. ' +
    'Use check_booking_tier first to know what to expect. Use get_available_slots to find valid times. ' +
    'If tier is "approval", the host will be notified and must approve before the meeting is confirmed. ' +
    'Name and email are auto-filled from your Bolo profile if not provided.',
  inputSchema: {
    type: 'object',
    properties: {
      handle: {
        type: 'string',
        description: 'The @handle to book with (e.g., "@sarah"). Either handle or participant_email is required.',
      },
      participant_email: {
        type: 'string',
        description: 'Email address to invite if the person is not on Bolo. Either handle or participant_email is required.',
      },
      start_time: {
        type: 'string',
        description: 'Meeting start time in ISO 8601 format (e.g., "2026-02-17T10:00:00-05:00")',
      },
      duration: {
        type: 'number',
        description: 'Duration in minutes (must match one of the host\'s allowed durations — check get_booking_profile)',
      },
      timezone: {
        type: 'string',
        description: 'Your timezone (e.g., "America/New_York")',
      },
      name: {
        type: 'string',
        description: 'Your name (optional — auto-filled from your Bolo profile)',
      },
      email: {
        type: 'string',
        description: 'Your email (optional — auto-filled from your Bolo profile)',
      },
      notes: {
        type: 'string',
        description: 'Meeting notes or description (optional)',
      },
      additional_handles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional Bolo @handles to include in the meeting (optional)',
      },
      additional_emails: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional email addresses to invite (optional)',
      },
    },
    required: ['start_time', 'duration', 'timezone'],
  },
};

export const handler: ToolHandler = async (args) => {
  const handle = args.handle ? cleanHandle(args.handle as string) : null;
  const participantEmail = args.participant_email as string | undefined;

  if (!handle && !participantEmail) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: 'Either handle or participant_email is required.',
        }, null, 2),
      }],
    };
  }

  // If handle is provided, check if it exists
  if (handle) {
    try {
      const lookup = await apiCall<HandleExistsResponse>(`/@${handle}/exists`);

      if (lookup.exists) {
        // Handle exists — use the standard booking flow
        const data = await apiCall<BookingResponse>(`/booking/${handle}/book`, {
          method: 'POST',
          body: {
            startTime: args.start_time,
            duration: args.duration,
            timezone: args.timezone,
            name: args.name,
            email: args.email,
            notes: args.notes,
            additionalHandles: args.additional_handles
              ? (args.additional_handles as string[]).map(cleanHandle)
              : undefined,
            additionalAttendees: args.additional_emails,
          },
        });

        const statusMessage = data.status === 'PENDING_APPROVAL'
          ? 'Booking request submitted. The host will be notified and must approve.'
          : 'Meeting confirmed! Calendar invites will be sent.';

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              booking: data,
              message: statusMessage,
            }, null, 2),
          }],
        };
      }
    } catch {
      // Handle doesn't exist or lookup failed — fall through to email flow
    }
  }

  // Email fallback: book via /meetings/book with participant email
  const emailToInvite = participantEmail || (handle ? `${handle}@unknown.com` : undefined);

  if (!emailToInvite || emailToInvite.endsWith('@unknown.com')) {
    const claimUrl = handle ? `https://bolospot.com/b/${handle}` : undefined;
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: `@${handle} is not registered on Bolo and no email address was provided.`,
          suggestion: 'Provide participant_email to send the invite via email.',
          claimUrl,
          message: claimUrl
            ? `They can claim @${handle} at ${claimUrl}`
            : undefined,
        }, null, 2),
      }],
    };
  }

  // Calculate end time from start + duration
  const startTime = new Date(args.start_time as string);
  const endTime = new Date(startTime.getTime() + (args.duration as number) * 60000);

  // Collect all participant emails
  const allEmails = [emailToInvite];
  if (args.additional_emails) {
    allEmails.push(...(args.additional_emails as string[]));
  }

  const data = await apiCall<any>('/meetings/book', {
    method: 'POST',
    body: {
      title: (args.notes as string) || `Meeting`,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      timezone: args.timezone,
      participantEmails: allEmails,
      participantHandles: args.additional_handles
        ? (args.additional_handles as string[]).map(cleanHandle)
        : [],
    },
  });

  const claimMessage = handle
    ? ` They can claim @${handle} at https://bolospot.com/b/${handle}`
    : '';

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        booking: data,
        message: `Meeting invite sent to ${emailToInvite} via email.${claimMessage}`,
        invitedViaEmail: true,
      }, null, 2),
    }],
  };
};
