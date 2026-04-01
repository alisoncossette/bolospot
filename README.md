<p align="center">
  <img src="https://bolospot.com/assets/logos/dark/1.svg" alt="Bolospot" width="280" />
</p>

<h3 align="center">Your AI life needs an address.</h3>

<p align="center">
  <a href="https://bolospot.com"><strong>bolospot.com</strong></a> &middot;
  <a href="https://world.bomed.ai"><strong>world.bomed.ai</strong></a> &middot;
  <a href="https://www.npmjs.com/package/bolo-mcp">MCP Server</a> &middot;
  <a href="https://bolo-api-650440848480.us-central1.run.app/api/docs">API Docs</a>
</p>

> Built for **PL Genesis 2026** — Web3 + Digital Human Rights track, with World ID integration.

---

## The problem nobody is solving

Everyone is building agents. Nobody is building for the **people those agents work for**.

The agentic economy is here. Commercial agents are booking your appointments. Personal agents are scheduling your life. AI is acting in your name every day — whether you chose it or not.

But there's no infrastructure for a normal person to participate in that confidently. No address. No way to say "yes, this agent can reach me" or "no, that one can't." No way to revoke it when things change.

Bolospot is that infrastructure. And it doesn't require a PhD to use.

**It's a toggle.** Your doctor can see your availability. Your accountant can't. A commercial scheduling agent can book you — but only within the rules you set. Your ex? One tap — gone.

This isn't about fear. It's about empowerment. The agentic economy only reaches its potential when consumers can actually participate in it — on their own terms. **Bolospot makes that possible.** And no one else is building it for consumers.

---

## How it works

You get a handle. `@alice`. That's your address — permanent, not tied to any app or platform.

Anything that wants to reach you, access your data, or act on your behalf has to ask. You approve or deny. You can revoke anytime, instantly.

```
Your PT office wants your insurance info.
They ask. You tap approve.
Your insurance auto-populates. You never dug for a card.

Six months later, you switch providers.
One tap. Access gone. No calls. No emails. Just done.
```

No intermediary. No admin. No platform in the middle.

---

## World ID integration

Bolospot uses **World ID** to verify the human behind every handle. When you claim `@alice`, you prove you're a real person — not a bot, not a duplicate. Your grants carry that verification forward.

Every transaction in the agentic economy starts with: *is this a real person who actually authorized this?* Bolospot answers that question.

Live demo: **[world.bomed.ai](https://world.bomed.ai)** — a real healthcare scheduling app built on the protocol.

---

## Why this is big

The agent economy is going to touch 8 billion people. Every one of them is going to need:

- A permanent identity that follows them across apps
- A way to control what their agents can access
- A way to revoke that access instantly

OAuth solves this for software. Nobody has solved it for people.

Bolospot is the permission layer that makes the agentic economy safe for normal humans — not by making it complicated, but by making it as simple as your banking app. You don't think about the infrastructure. You just manage your life.

| The old way | Bolospot |
|------------|----------|
| Platform controls your data | You control your data |
| Admin assigns permissions | You grant them directly |
| Revocation takes days | One tap. Instant. |
| Trust leaks (transitive) | Non-transitive by design |
| Cached tokens | Checked every single request |

---

## Who can request access

Anything can request access to you — a healthcare app, a scheduling service, a calendar, a recruiting platform, an AI agent. It registers with the protocol so you know who's asking. You decide what they get.

| | Requester | What they're asking for |
|---|--------|-------------|
| 🩺 | **[BoMed](https://world.bomed.ai)** | Your PT office wants to book you and auto-fill your insurance |
| 📅 | **Calendar** | A scheduling service wants to see your availability |
| 💕 | **BoLove** | A dating agent wants to negotiate compatibility on your behalf |
| 🧑‍💻 | **BoHire** | A recruiter wants to verify your credentials and schedule an interview |

Any service, agent, or platform can request access: `POST /api/widgets/register`

---

## Architecture

```
apps/
  api/            NestJS API — grants, identity, scheduling, relay, widgets
  mcp-server/     MCP server — any AI agent connects via Model Context Protocol
packages/
  bolo-sdk/       TypeScript SDK
```

### Core concepts

| | What it does |
|-----------|---------|
| **@handle** | Your permanent address. One identity across every service and agent. |
| **Permission grant** | You approve access. Scoped, real-time, instantly revocable. |
| **Relay** | Your agent talks to their agent. Only what you allow crosses the boundary. |
| **Trust graph** | Non-transitive. Checked on every request. No cached tokens. |

---

## MCP Server

Any AI agent can connect to the trust graph:

```bash
BOLO_API_KEY=bolo_live_xxx npx bolo-mcp
```

21 tools including: `lookup_handle`, `check_access`, `request_access`, `create_grant`, `revoke_grant`, `relay_send`, `find_mutual_time`, `book_meeting`, and more.

**Self-grant gate**: your agent only does what you've allowed. Fail-closed.

---

## SDK

```bash
npm install bolo-sdk
```

```typescript
import { BoloClient } from 'bolo-sdk';

const bolo = new BoloClient({ apiKey: 'bolo_live_xxx' });

// Check if someone has granted you access
const access = await bolo.checkAccess('@alice');

// Request access to a widget
await bolo.requestAccess({
  handle: '@alice',
  widget: 'bomed',
  scopes: ['patients:read'],
  message: 'Vermont PT requesting insurance info',
});
```

---

## API

Live: **[bolo-api/docs](https://bolo-api-650440848480.us-central1.run.app/api/docs)**

```
POST   /api/grants              Grant access
DELETE /api/grants/:id          Revoke instantly
GET    /api/users/handle/:handle  Look up any handle
POST   /api/widgets/register    Register a new widget type
POST   /api/relay/send          Agent-to-agent message
```

---

<p align="center">
  <strong>AI is making decisions about you, for you, every day.<br/>Right now? You have no say.<br/>Bolospot changes that.</strong>
</p>

<p align="center">
  <a href="https://bolospot.com"><strong>bolospot.com</strong></a> &middot;
  <a href="https://world.bomed.ai"><strong>See it live → world.bomed.ai</strong></a>
</p>
