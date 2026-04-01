import { apiCall } from '../api-client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';

export const definition: ToolDefinition = {
  name: 'update_profile',
  description:
    'Update your Bolo profile and availability settings. All fields are optional — include only what you want to change. ' +
    'Covers identity (name, timezone), working hours, and booking settings (durations, buffers).',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Your display name',
      },
      timezone: {
        type: 'string',
        description: 'Your timezone (e.g., "America/New_York")',
      },
      workingHoursStart: {
        type: 'number',
        description: 'Start of working hours (0-23)',
      },
      workingHoursEnd: {
        type: 'number',
        description: 'End of working hours (0-23)',
      },
      workingDays: {
        type: 'array',
        items: { type: 'number' },
        description: 'Working days as numbers (0=Sunday, 1=Monday, ..., 6=Saturday)',
      },
      durations: {
        type: 'array',
        items: { type: 'number' },
        description: 'Allowed meeting durations in minutes (e.g., [15, 30, 60])',
      },
      bufferBefore: {
        type: 'number',
        description: 'Buffer time in minutes before each meeting',
      },
      bufferAfter: {
        type: 'number',
        description: 'Buffer time in minutes after each meeting',
      },
      bookingName: {
        type: 'string',
        description: 'Display name for your booking profile (if different from your main name)',
      },
      bookingDescription: {
        type: 'string',
        description: 'Description for your booking profile',
      },
    },
  },
};

export const handler: ToolHandler = async (args) => {
  // Split fields across the two endpoints they belong to
  const profileBody: Record<string, unknown> = {};
  const bookingBody: Record<string, unknown> = {};

  // User profile endpoint fields
  if (args.name !== undefined) profileBody.name = args.name;
  if (args.timezone !== undefined) profileBody.timezone = args.timezone;
  if (args.workingHoursStart !== undefined) profileBody.workingHoursStart = args.workingHoursStart;
  if (args.workingHoursEnd !== undefined) profileBody.workingHoursEnd = args.workingHoursEnd;
  if (args.workingDays !== undefined) profileBody.workingDays = args.workingDays;

  // Booking profile endpoint fields
  if (args.durations !== undefined) bookingBody.durations = args.durations;
  if (args.bufferBefore !== undefined) bookingBody.bufferBefore = args.bufferBefore;
  if (args.bufferAfter !== undefined) bookingBody.bufferAfter = args.bufferAfter;
  if (args.bookingName !== undefined) bookingBody.name = args.bookingName;
  if (args.bookingDescription !== undefined) bookingBody.description = args.bookingDescription;

  if (Object.keys(profileBody).length === 0 && Object.keys(bookingBody).length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: true,
          message: 'No fields provided. Specify at least one of: name, timezone, workingHoursStart, workingHoursEnd, workingDays, durations, bufferBefore, bufferAfter, bookingName, bookingDescription.',
        }),
      }],
      isError: true,
    };
  }

  const results: Record<string, unknown> = {};
  const updated: string[] = [];

  if (Object.keys(profileBody).length > 0) {
    const data = await apiCall<Record<string, unknown>>('/users/profile/key', {
      method: 'PATCH',
      body: profileBody,
    });
    results.profile = data;
    updated.push(...Object.keys(profileBody));
  }

  if (Object.keys(bookingBody).length > 0) {
    const data = await apiCall<Record<string, unknown>>('/booking/profile/key', {
      method: 'PATCH',
      body: bookingBody,
    });
    results.booking = data;
    updated.push(...Object.keys(bookingBody));
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ...results,
        summary: `Profile updated. Changed: ${updated.join(', ')}.`,
      }, null, 2),
    }],
  };
};
