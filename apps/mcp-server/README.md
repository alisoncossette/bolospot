# Bolo MCP Server

> Be on the look out for your ID. Your AI gatekeeper.

This MCP (Model Context Protocol) server lets AI agents schedule meetings through Bolo. Connect your calendar once, and any AI can check your availability and book time with you.

## What It Does

```
User: "Hey Claude, schedule a 30-min call with @alice next week"

Claude → calls get_availability("@alice")
       → calls find_mutual_time(["@me", "@alice"], 30)
       → calls book_meeting(...)
       → Done. Calendar invites sent.
```

## Installation

### For Claude Desktop

Add to your Claude config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "bolo": {
      "command": "npx",
      "args": ["@bolo/mcp-server"],
      "env": {
        "BOLO_API_KEY": "your-api-key"
      }
    }
  }
}
```

### For Other AI Platforms

The server uses stdio transport and follows the MCP spec. Any MCP-compatible client can connect.

## Available Tools

### `get_availability`

Get a person's free time slots by their @handle.

```json
{
  "handle": "@johndoe",
  "startDate": "2024-01-15",
  "endDate": "2024-01-22",
  "timezone": "America/New_York"
}
```

Returns free slots across ALL their connected calendars (Google, Outlook, Apple, etc.)

### `find_mutual_time`

Find times when multiple people are all available.

```json
{
  "handles": ["@johndoe", "@alice", "@bob"],
  "duration": 30,
  "startDate": "2024-01-15",
  "endDate": "2024-01-22"
}
```

### `book_meeting`

Create a meeting and send calendar invites.

```json
{
  "handles": ["@alice", "@bob"],
  "title": "Project Kickoff",
  "startTime": "2024-01-15T10:00:00-05:00",
  "endTime": "2024-01-15T10:30:00-05:00",
  "description": "Initial planning session",
  "location": "https://zoom.us/j/123456"
}
```

### `lookup_handle`

Find someone's @handle by email or name.

```json
{
  "query": "alice@company.com"
}
```

## Get Your Bolo

1. Go to [bolo.id](https://bolo.id) (coming soon)
2. Claim your @handle
3. Connect your calendars
4. Get your API key
5. Add to Claude or any AI

## Platform Agnostic

This works with ANY AI agent:
- Claude (via MCP)
- ChatGPT (via plugin API - coming)
- Any agent that supports MCP
- Custom integrations via REST API

## You Own Everything

- Your data stays yours
- Export anytime
- No lock-in
- Full audit trail of every action

## Development

```bash
# Install dependencies
pnpm install

# Run in development
pnpm dev

# Build
pnpm build

# Run built version
pnpm start
```

## License

MIT
