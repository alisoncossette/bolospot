# Bolo MCP Server

> Be on the look out for your ID. Your AI gatekeeper.

MCP (Model Context Protocol) server for Bolo — peer-to-peer digital permissions for AI agents. Connect your calendar, manage trust grants, and let agents communicate through the relay.

## Installation

```bash
npm install -g @bolospot/mcp
# or use npx for zero-install
npx @bolospot/mcp
```

## Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "bolo": {
      "command": "npx",
      "args": ["-y", "@bolospot/mcp"],
      "env": {
        "BOLO_API_KEY": "bolo_live_..."
      }
    }
  }
}
```

Get your API key at [bolospot.com/dashboard/api-keys](https://bolospot.com/dashboard/api-keys).

## Toolsets

Control which tools are exposed with `BOLO_TOOLSET`:

| Toolset | Tools | For |
|---------|-------|-----|
| `developer` | 14 | Widget builders (relay, grants, widget registration) |
| `scheduling` | 7 | Scheduling agents (availability, booking, events) |
| `account` | 4 | Profile and settings management |
| `all` | 21 | Everything (default) |

```json
{
  "env": {
    "BOLO_API_KEY": "bolo_live_...",
    "BOLO_TOOLSET": "developer"
  }
}
```

## Available Tools (21)

### Scheduling
- **get_availability** — busy periods or bookable time slots for a @handle
- **find_mutual_time** — find when multiple people are all free
- **get_booking_profile** — public booking profile (durations, working hours)
- **book_meeting** — book a meeting with a @handle or email
- **get_events** — calendar events (your own or another @handle's)

### Permissions & Grants
- **check_access** — what has a @handle shared with you (includes booking tier)
- **request_access** — request access to a permission category
- **create_grant** — grant access to another @handle
- **revoke_grant** — revoke a previously created grant
- **list_bolos** — list grants sent, received, or both

### Agent Relay
- **relay_send** — send a query through the trust boundary
- **relay_inbox** — check for incoming queries
- **relay_reply** — reply to a query
- **relay_check_responses** — poll for responses to your queries
- **relay_ack** — acknowledge processed messages

### Widget Development
- **register_widget** — register a new permission category for your app
- **update_widget** — update a registered widget
- **deactivate_widget** — deactivate a registered widget
- **list_widgets** — list all available permission categories

### Identity & Profile
- **lookup_handle** — check if a @handle is registered
- **update_profile** — update profile, availability, and booking settings

## Quick Example

```
User: "Schedule a 30-min call with @alice next week"

Claude → check_access("@alice")                    # grants + booking tier
       → get_availability("@alice", duration: 30)  # bookable slots
       → book_meeting(...)                         # confirmed
```

## Full Documentation

See [bolospot.com/docs/mcp-tools](https://bolospot.com/docs/mcp-tools) for complete tool reference with parameters and examples.

## Development

```bash
pnpm install
pnpm dev        # run with tsx
pnpm build      # compile TypeScript
pnpm start      # run compiled
```

## License

MIT
