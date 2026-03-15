#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { tools, toolMap } from './tools/index.js';
import {
  widgetsResource, readWidgets,
  accessResourceTemplate, readAccess,
  profileResourceTemplate, readProfile,
} from './resources/index.js';
import {
  scheduleMeetingPrompt, getScheduleMeetingMessages,
  checkPermissionsPrompt, getCheckPermissionsMessages,
} from './prompts/index.js';

// Create the MCP server
const server = new Server(
  {
    name: 'bolo',
    version: '0.2.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  },
);

// ─── Tools ───────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(t => ({
    name: t.definition.name,
    description: t.definition.description,
    inputSchema: t.definition.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = toolMap.get(name);

  if (!handler) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: true, message: `Unknown tool: ${name}` }) }],
      isError: true,
    };
  }

  try {
    return await handler(args ?? {});
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: true,
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      }],
      isError: true,
    };
  }
});

// ─── Resources ───────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: widgetsResource.uri,
      name: widgetsResource.name,
      description: widgetsResource.description,
      mimeType: widgetsResource.mimeType,
    },
  ],
}));

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    {
      uriTemplate: accessResourceTemplate.uriTemplate,
      name: accessResourceTemplate.name,
      description: accessResourceTemplate.description,
      mimeType: accessResourceTemplate.mimeType,
    },
    {
      uriTemplate: profileResourceTemplate.uriTemplate,
      name: profileResourceTemplate.name,
      description: profileResourceTemplate.description,
      mimeType: profileResourceTemplate.mimeType,
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  // Static resource: bolo://widgets
  if (uri === 'bolo://widgets') {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: await readWidgets(),
      }],
    };
  }

  // Template: bolo://access/{handle}
  const accessMatch = uri.match(/^bolo:\/\/access\/(.+)$/);
  if (accessMatch) {
    const handle = accessMatch[1];
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: await readAccess(handle),
      }],
    };
  }

  // Template: bolo://profile/{handle}
  const profileMatch = uri.match(/^bolo:\/\/profile\/(.+)$/);
  if (profileMatch) {
    const handle = profileMatch[1];
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: await readProfile(handle),
      }],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// ─── Prompts ─────────────────────────────────────────────

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    scheduleMeetingPrompt,
    checkPermissionsPrompt,
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'schedule_meeting': {
      const handle = (args?.handle as string || '').replace(/^@/, '');
      if (!handle) throw new Error('handle argument is required');
      return getScheduleMeetingMessages(handle, args?.duration as string);
    }
    case 'check_permissions': {
      const handle = (args?.handle as string || '').replace(/^@/, '');
      if (!handle) throw new Error('handle argument is required');
      return getCheckPermissionsMessages(handle);
    }
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
});

// ─── Start ───────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Bolo MCP server running — be on the look out');
}

main().catch(console.error);
