<p align="center">
  <img src="https://bolospot.com/assets/logos/dark/1.svg" alt="Bolospot" width="280" />
</p>

<h3 align="center">The trust protocol for the agent economy.</h3>

<p align="center">
  <strong>One handle. Total control.</strong><br/>
  Don't let the human be the bottleneck in the agentic economy.
</p>

<p align="center">
  <a href="https://bolospot.com">Website</a> &middot;
  <a href="https://www.npmjs.com/package/bolo-mcp">MCP Server</a> &middot;
  <a href="https://bolo-api-650440848480.us-central1.run.app/api/docs">API Docs</a> &middot;
  <a href="https://bomed.ai">BoMed</a>
</p>

---

## Why This Matters

AI agents are the biggest coordination problem since the internet. Every agent needs to talk to other agents, access your data, and act on your behalf.

Right now there are two options: **wide open** (dangerous) or **human in the loop** (doesn't scale).

Bolo is the third option: **set your rules, agents operate within them, revoke anytime.** The human sets policy. The trust layer enforces it.

This is **sovereign infrastructure** — no central authority controls the trust relationship between two peers. Permissions follow people, not platforms.

> Built for [Funding the Commons SF 2026](https://fundingthecommons.io) — Sovereign Infrastructure track.

---

## How It Works

```
You (@alice)                    Your PT Office (@vermontpt)
    |                                    |
    |  "Grant @vermontpt access          |
    |   to bomed:patients:read"          |
    |                                    |
    | ──── bolo (grant) ──────────────>  |
    |                                    |  Types @alice
    |                                    |  Insurance auto-populates
    |                                    |
    |  "Revoke."                         |
    | ──── bolo (revoke) ─────────────>  |
    |                                    |  Data disappears. Instantly.
```

A **bolo** is the atomic trust object. It starts as a request, becomes a grant, can be revoked. Peer-to-peer. No intermediary.

---

## The Commons Case

Traditional permission systems are **top-down**: an admin assigns roles, a platform controls access, an OAuth provider decides what scopes exist.

Bolo is **sideways**: two peers negotiate trust directly.

| Traditional | Bolo |
|------------|------|
| Admin assigns roles | Peers grant directly |
| Platform controls scopes | Widgets define their own |
| Cached tokens | Real-time trust graph check |
| Revocation is slow | Instant. Checked every request. |
| Transitive (leaked trust) | Non-transitive by design |

**Sovereignty test**: if any single company, API, or cloud goes down — does the trust relationship survive? With Bolo, permissions follow people, not infrastructure.

---

## Widgets

Widgets are apps built on Bolospot — like apps on your phone, but each one only gets the data you grant it. Any developer can register new permission categories. The protocol doesn't prescribe what permissions exist — **the ecosystem does.**

| | Widget | What it does | Scopes |
|---|--------|-------------|--------|
| 📅 | **Calendar** | Scheduling & availability | `free_busy` `events:read` `events:create` |
| 🩺 | **[BoMed](https://bomed.ai)** | Healthcare scheduling & insurance | `appointments:book` `patients:read` |
| 💕 | **BoLove** | Dating via agent relay | `date:initiate` `profile:share` |
| 🧑‍💻 | **BoHire** | Recruiting & interviews | `interviews:schedule` `candidates:read` |
| 🐞 | **Ladybug** | AI reading robot + voice | `voice:use` `voice:clone` |

Register your own: `POST /api/widgets/register`

---

## Architecture

```
apps/
  api/            NestJS API — grants, scheduling, identity, relay, widgets
  mcp-server/     MCP server — AI agents connect via Model Context Protocol
packages/
  bolo-sdk/       TypeScript SDK for the Bolo API
```

### Core Primitives

| Primitive | Purpose |
|-----------|---------|
| **Handles** | `@alice` is your identity. Agents, people, and orgs all get handles. |
| **Bolos** | Peer-to-peer permission grants. Request, accept, revoke. |
| **Widgets** | Third-party apps register their own permission categories. |
| **Relay** | Agent-to-agent messaging through the trust boundary. |
| **Trust Graph** | Non-transitive. Checked on every request. No cached tokens. |

---

## MCP Server

Connect any AI agent to Bolospot:

```bash
npx bolo-mcp
```

```bash
BOLO_API_KEY=bolo_live_xxx npx bolo-mcp
```

**10 tools:**

| Tool | Description |
|------|-------------|
| `lookup_handle` | Find a user by @handle |
| `check_access` | Check if a grant exists |
| `request_access` | Send a bolo (request permissions) |
| `list_widgets` | See all permission categories |
| `get_availability` | Check someone's calendar |
| `find_mutual_time` | Find overlapping free time |
| `get_available_slots` | Get bookable slots |
| `book_meeting` | Book a meeting |
| `get_booking_profile` | Get booking preferences |
| `check_booking_tier` | Check access level |

**Self-grant gate**: when `BOLO_SELF_GRANTS` is enabled, every tool call checks against the owner's permissions before executing. Your agent only does what you allow. Fail-closed.

---

## SDK

```bash
npm install bolo-sdk
```

```typescript
import { BoloClient } from 'bolo-sdk';

const bolo = new BoloClient({ apiKey: 'bolo_live_xxx' });

// Look up a handle
const user = await bolo.lookupHandle('@alice');

// Send a bolo (request access)
await bolo.requestAccess({
  handle: '@alice',
  widget: 'bomed',
  scopes: ['patients:read'],
  message: 'Vermont PT requesting insurance info',
});

// Check access
const access = await bolo.checkAccess('@alice');

// List all widgets
const widgets = await bolo.listWidgets();
```

---

## API

Live Swagger docs: **[bolo-api/docs](https://bolo-api-650440848480.us-central1.run.app/api/docs)**

```
POST   /api/grants              Create a bolo (grant access)
GET    /api/grants/given         Bolos you've given
GET    /api/grants/received      Bolos you've received
DELETE /api/grants/:id           Revoke a bolo
GET    /api/grants/widgets       List all widget categories
GET    /api/users/handle/:handle Look up a user
GET    /api/availability/:handle Check availability
POST   /api/meetings/book        Book a meeting
POST   /api/widgets/register     Register a new widget
POST   /api/relay/send           Send agent-to-agent message
```

---

## Design Principles

**Permissions follow people, not software.** Agents inherit their owner's @handle.

**Non-transitive trust.** Alice trusts Bob. Bob trusts Carol. Alice's agent CANNOT reach Carol. Trust doesn't leak.

**Real-time revocation.** Every request checks the trust graph. No cached tokens. Kill it and it's dead.

**Policy, not approval.** Set your rules once. Agents operate within them. The human is the policy maker, not the bottleneck.

**Open protocol.** Any developer can register widgets, build clients, extend the trust layer. This is commons infrastructure.

---

<p align="center">
  <strong>8 billion people are about to have AI agents.<br/>None of them have a handle yet.</strong>
</p>

<p align="center">
  <a href="https://bolospot.com">Claim yours at bolospot.com</a>
</p>

<p align="center">
  <sub>Built for <a href="https://fundingthecommons.io">Funding the Commons SF 2026</a> — Sovereign Infrastructure</sub>
</p>
