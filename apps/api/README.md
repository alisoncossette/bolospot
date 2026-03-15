# Bolo API

**The backend for Bolospot — peer-to-peer permissions for AI agents.**

NestJS API powering handles, bolos (grants), widgets, scheduling, agent relay, and identity verification.

Live: **[API Docs (Swagger)](https://bolo-api-650440848480.us-central1.run.app/api/docs)**

## Core Modules

### Identity (`/api/users`, `/api/auth`)

Every person, agent, and organization gets a `@handle`. Handles are permanent, lowercase, and globally unique.

```
GET  /api/users/handle/:handle    Look up a public profile
GET  /api/users/check-handle/:h   Check if a handle is available
POST /api/auth/register           Create account + claim handle
POST /api/auth/login              Email/password login
GET  /api/auth/google/authorize   Google OAuth
GET  /api/auth/microsoft/authorize Microsoft OAuth
GET  /api/auth/me                 Current authenticated user
```

### Bolos — Grants (`/api/grants`)

A **bolo** is the atomic trust object. It starts as a request, becomes a grant, can be revoked instantly. Peer-to-peer — no admin, no platform in the middle.

```
POST   /api/grants                Create a bolo (grant access)
GET    /api/grants/given          Bolos you've given out
GET    /api/grants/received       Bolos you've received
DELETE /api/grants/:id            Revoke a bolo — instant, checked every request
GET    /api/grants/widgets        List all widget categories
GET    /api/grants/requests       Pending bolo requests
PATCH  /api/grants/requests/:id   Accept or deny a request
```

**Grant structure:**
```json
{
  "granteeHandle": "vermontpt",
  "widget": "bomed",
  "scopes": ["patients:read", "appointments:book"],
  "expiresAt": "2026-06-01T00:00:00Z",
  "note": "PT office access to insurance"
}
```

**Non-transitive:** Alice grants Bob. Bob grants Carol. Alice's agent CANNOT reach Carol. Trust doesn't leak.

**Real-time:** Every API request checks the trust graph. No cached tokens. Revoke a bolo and it's dead on the next request.

### Widgets (`/api/widgets`)

Widgets are third-party apps that register their own permission categories. The protocol doesn't prescribe what permissions exist — the ecosystem does.

```
POST   /api/widgets/register      Register a new widget
GET    /api/grants/widgets        List all widgets + scopes
PATCH  /api/widgets/:slug         Update (owner or admin only)
DELETE /api/widgets/:slug         Deactivate (owner or admin only)
```

**Register a widget:**
```json
{
  "slug": "bomed",
  "name": "BoMed",
  "description": "Healthcare scheduling & insurance",
  "icon": "🩺",
  "scopes": ["appointments:read", "appointments:book", "patients:read"]
}
```

**Current widgets:**

| Widget | Scopes |
|--------|--------|
| 📅 Calendar | `free_busy`, `events:read`, `events:create` |
| 🩺 BoMed | `appointments:read`, `appointments:book`, `patients:read` |
| 💕 BoLove | `date:initiate`, `date:respond`, `profile:share` |
| 🧑‍💻 BoHire | `interviews:schedule`, `candidates:read`, `profiling:assess` |
| 🐞 Ladybug | `voice:use`, `voice:clone` |

### Scheduling (`/api/availability`, `/api/meetings`, `/api/booking`)

Cross-calendar availability and booking. Connects Google Calendar and Microsoft Outlook.

```
GET  /api/availability/:handle           Free/busy for a handle
GET  /api/availability/mutual            Mutual availability across handles
POST /api/meetings                       Create a meeting
POST /api/meetings/book                  Book a confirmed meeting
GET  /api/booking/:handle/slots          Available booking slots
GET  /api/booking/:handle/profiles       Booking profiles (duration, type)
POST /api/booking/:handle/book           Book via public page
```

### Calendar Connections (`/api/connections`)

```
GET    /api/connections                        List connected calendars
GET    /api/connections/google/authorize        Connect Google Calendar
GET    /api/connections/microsoft/authorize     Connect Microsoft Outlook
DELETE /api/connections/:id                     Disconnect
POST   /api/connections/:id/sync               Force sync
POST   /api/connections/sync-busy-blocks        Sync busy blocks across calendars
```

### Agent Relay (`/api/relay`)

Agent-to-agent messaging through the trust boundary. Only crafted responses cross the wall.

```
POST /api/relay/send              Send a message to another agent
GET  /api/relay/inbox             Check incoming messages
POST /api/relay/:id/reply         Reply to an agent query
GET  /api/relay/responses         Check responses to your queries
POST /api/relay/ack               Acknowledge messages
```

**Send a relay message:**
```json
{
  "recipientHandle": "alice",
  "content": "Requesting insurance information for appointment",
  "widgetSlug": "bomed",
  "metadata": { "type": "insurance_request" }
}
```

### Public Booking Page (`/api/@:handle`)

The `@handle` page — your digital doorstep. People and agents request access here.

```
GET  /api/@:handle/exists         Does this handle exist?
GET  /api/@:handle/access         Check your access level to this handle
GET  /api/@:handle/access/key     Check access via API key
POST /api/@:handle/request        Request access (send a bolo)
```

## Auth

Three authentication methods, checked in order:

1. **Session cookie** (`bolo_session`) — set after OAuth or email login
2. **X-Session-Id header** — cross-domain fallback
3. **JWT Bearer token** — transition support
4. **API key** (`bolo_live_` prefix) — for MCP server and programmatic access

## Stack

- **Runtime:** NestJS on Node.js
- **Database:** PostgreSQL (Neon) via Prisma
- **Auth:** Session-based + JWT transition + API keys (SHA-256 hashed)
- **Calendar:** Google Calendar API + Microsoft Graph API
- **Hosting:** Google Cloud Run
- **Email:** Resend

## Development

```bash
cd apps/api

# Install
pnpm install

# Set up env
cp .env.example .env
# Fill in DATABASE_URL, GOOGLE_CLIENT_ID, etc.

# Generate Prisma client
npx prisma generate

# Push schema to DB
npx prisma db push

# Run
pnpm dev        # http://localhost:3001
```

Swagger docs at `http://localhost:3001/api/docs`
