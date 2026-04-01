export const checkPermissionsPrompt = {
  name: 'check_permissions',
  description: 'Check what access you have with a specific person on Bolo.',
  arguments: [
    {
      name: 'handle',
      description: 'The @handle to check (e.g., "@sarah")',
      required: true,
    },
  ],
};

export function getCheckPermissionsMessages(handle: string) {
  return {
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text:
            `Check my Bolo access with @${handle}.\n\n` +
            `Use check_access to see what they've shared with me (it includes booking tier too), and let me know:\n` +
            `- What permission categories (widgets) I have access to and their scopes\n` +
            `- What I could request that I don't have yet (use list_widgets as reference)\n` +
            `- What booking tier I get (direct, approval, or blocked)\n` +
            `- Whether I have any pending access requests`,
        },
      },
    ],
  };
}
