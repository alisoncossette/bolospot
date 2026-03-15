# bolo-mcp

**Give your AI agent a trust layer.**

Your agent can schedule meetings, check permissions, message other agents, and access data — but only what you've allowed. Every action goes through the Bolo trust graph. No grant, no access.

```
You: "Book a PT appointment with Vermont Physical Therapy"

Claude → lookup_handle("@vermontpt")          ✓ found
       → check_access("@vermontpt", "bomed")  ✓ granted
       → get_availability("@vermontpt")        ✓ 3 slots
       → book_meeting(...)                     ✓ booked
       → "You're booked for Tuesday at 2pm."

You: "Revoke their access to my insurance."

Claude → revoke. Done. They see nothing.
```

## Install

```bash
npm install -g bolo-mcp
```

### Claude Desktop

```json
{
  "mcpServers": {
    "bolo": {
      "command": "npx",
      "args": ["bolo-mcp"],
      "env": {
        "BOLO_API_KEY": "bolo_live_xxx"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add bolo -- npx bolo-mcp
```

### Any MCP Client

Stdio transport. Follows the spec. If your agent speaks MCP, it speaks Bolo.

## Tools

### Identity & Access

| Tool | What your agent can do |
|------|----------------------|
| `lookup_handle` | Find anyone by @handle |
| `check_access` | "Do I have permission to access this?" |
| `request_access` | Send a bolo — request permission from another handle |
| `list_widgets` | See what permission categories exist |

### Scheduling

| Tool | What your agent can do |
|------|----------------------|
| `get_availability` | Check someone's free time across all their calendars |
| `find_mutual_time` | Find when multiple people are all free |
| `get_available_slots` | Get bookable time slots |
| `book_meeting` | Book it. Calendar invites sent automatically. |
| `get_booking_profile` | Get someone's booking preferences |
| `check_booking_tier` | What level of access do you have? |

### Agent-to-Agent Relay

| Tool | What your agent can do |
|------|----------------------|
| `relay_send` | Send a message to another agent through the trust boundary |
| `relay_inbox` | Check incoming messages from other agents |
| `relay_reply` | Reply to an agent query |
| `relay_check_responses` | Check if anyone responded to your query |

## Self-Grant Gate

Your agent only does what **you** allow.

```bash
BOLO_SELF_GRANTS=true BOLO_API_KEY=bolo_live_xxx npx bolo-mcp
```

When enabled, every tool call is checked against your self-grant permissions before executing. If you haven't granted `schedule:write` to your own agent, it can't book meetings — even if someone else granted you access.

```
Agent tries: book_meeting(...)
Gate checks: owner has "schedule:write"?
  → Yes: proceeds
  → No:  "Permission denied. Your owner has not granted
          schedule:write to this agent."
```

**Fail-closed.** No grants = no access. The agent tells you exactly what permission it needs and where to enable it.

## The Protocol

Bolo isn't just a scheduling tool. It's the trust layer between agents.

```
┌──────────────┐         ┌──────────────┐
│  Your Agent  │  bolo   │ Their Agent  │
│  (@alice)    │ ◄─────► │ (@vermontpt) │
└──────┬───────┘         └──────┬───────┘
       │                        │
   self-grants              self-grants
       │                        │
┌──────┴───────┐         ┌──────┴───────┐
│     You      │         │    Them      │
│  (policy)    │         │  (policy)    │
└──────────────┘         └──────────────┘
```

Both sides set policy. Both sides control their agents. The relay carries messages. The trust graph enforces boundaries. Nobody is the bottleneck.

## Get Started

1. Claim your @handle at [bolospot.com](https://bolospot.com)
2. Get your API key from the dashboard
3. `npx bolo-mcp` — your agent is live

---

<p align="center">
  <a href="https://www.npmjs.com/package/bolo-mcp">npm</a> &middot;
  <a href="https://bolospot.com">bolospot.com</a> &middot;
  <a href="https://bolo-api-650440848480.us-central1.run.app/api/docs">API docs</a>
</p>
