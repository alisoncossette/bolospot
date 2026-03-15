export const scheduleMeetingPrompt = {
  name: 'schedule_meeting',
  description: 'Walk through the full process of scheduling a meeting with someone on Bolo.',
  arguments: [
    {
      name: 'handle',
      description: 'The @handle to schedule with (e.g., "@sarah")',
      required: true,
    },
    {
      name: 'duration',
      description: 'Desired meeting duration in minutes (e.g., "30")',
      required: false,
    },
  ],
};

export function getScheduleMeetingMessages(handle: string, duration?: string) {
  return {
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text:
            `I need to schedule a ${duration || '30'}-minute meeting with @${handle} on Bolo.\n\n` +
            `Please follow these steps:\n` +
            `1. First check if I have access to @${handle}'s calendar using check_access\n` +
            `2. If I don't have calendar access, use request_access to ask for calendar:free_busy and events:create scopes, then let me know I need to wait for approval\n` +
            `3. If I have access, check their booking profile with get_booking_profile to see available durations and working hours\n` +
            `4. Check my booking tier with check_booking_tier to know if I can book directly or need approval\n` +
            `5. Get their available slots for the next few business days using get_available_slots\n` +
            `6. Suggest the best options and let me pick one\n` +
            `7. Book the meeting once I confirm using book_meeting`,
        },
      },
    ],
  };
}
