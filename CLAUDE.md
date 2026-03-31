# CLAUDE.md - Bolospot

## What is this project?

Bolospot is a sovereign infrastructure platform implementing a peer-to-peer trust protocol for the AI agent economy. Users control permissions via "bolos" (grants) that agents use to access data and perform actions on behalf of users. Trust is non-transitive (Alice granting Bob access does not let Bob's contacts access Alice), revocation is real-time, and the system is fail-closed (no access unless explicitly granted).

## Repository Structure

Monorepo with three packages:

```
apps/
  api/           # NestJS backend API (port 8080, prefix /api)
  mcp-server/    # Model Context Protocol server for AI agents (stdio transport)
packages/
  bolo-sdk/      # TypeScript SDK for building on Bolo
```

### API Modules (`apps/api/src/modules/`)

| Module | Purpose |
|--------|---------|
| auth | OAuth (Google, Microsoft), email login, session management |
| users | User profiles, handle management |
| grants | Permission grants (bolos) - request/accept/revoke |
| relay | Agent-to-agent messaging through trust boundary |
| widgets | Permission categories (calendar, dating, scheduling, etc.) |
| connections | Calendar OAuth connections (Google, Microsoft) |
| availability | Free/busy checking, calendar sync |
| meetings | Meeting scheduling across calendars |
| booking | Public booking profiles and slots |
| invitations | Meeting invitation management |
| api-keys | API key generation and management (SHA-256 hashed, `bolo_live_` prefix) |
| approvals | User approval workflows |
| contacts | Trusted contact management with routing rules |
| identity-verification | ID verification (IDME, Jumio, Onfido, Persona, Clear) |
| events | Unified calendar events |
| billing | Stripe integration, subscription management (FREE/PRO/BUILDER) |
| email | Resend email provider |
| health | Health check endpoints |
| admin | Super-admin operations |
| moltbook | Dual auth guard for identity verification |
| internal-access | Internal service access |
| redis | Redis client management |

### MCP Server (`apps/mcp-server/`)

16 tools, 3 resources, 2 prompts. Key tool groups:
- **Identity & Access**: lookup_handle, check_access, request_access, list_widgets
- **Scheduling**: get_availability, find_mutual_time, book_meeting, get_available_slots
- **Agent Relay**: relay_send, relay_inbox, relay_reply, relay_check_responses
- **Admin**: register_widget

## Tech Stack

- **Framework**: NestJS 10 + TypeScript 5.3
- **Database**: PostgreSQL (Neon) via Prisma ORM
- **Cache/Rate Limiting**: Redis (ioredis)
- **Auth**: Session cookies + JWT (transition) + API keys
- **Calendar**: Google Calendar API (googleapis) + Microsoft Graph API
- **Email**: Resend
- **Payments**: Stripe
- **Validation**: class-validator + class-transformer (DTOs), Zod (MCP server)
- **Docs**: Swagger/OpenAPI at `/api/docs`
- **Hosting**: Google Cloud Run

## Development Commands

```bash
# From apps/api/:
pnpm dev              # NestJS watch mode (port 8080)
pnpm build            # Compile TypeScript
pnpm start:prod       # Run compiled output
pnpm lint             # ESLint with auto-fix
pnpm test             # Jest unit tests
pnpm test:e2e         # E2E tests
pnpm typecheck        # tsc --noEmit

# Database:
npx prisma generate   # Generate Prisma client
npx prisma db push    # Push schema to database
pnpm db:seed          # Seed identity types + default widgets

# MCP Server (from apps/mcp-server/):
pnpm dev              # Run with tsx
pnpm build            # Compile TypeScript
```

## Code Conventions

### Module Pattern

Every domain module follows this structure:
```
module/
  module.module.ts       # NestJS module (imports, providers, exports)
  module.controller.ts   # Routes with guards and Swagger decorators
  module.service.ts      # Business logic, Prisma queries
  dto/
    *.dto.ts             # Request/response DTOs with class-validator
  guards/
    *.guard.ts           # Custom auth/rate-limit guards
```

### Authentication Guards

Use the appropriate guard for each endpoint:
- `SessionAuthGuard` - Requires authenticated session (primary)
- `OptionalSessionAuthGuard` - Session optional
- `JwtAuthGuard` / `OptionalJwtAuthGuard` - Bearer token (legacy transition)
- `ApiKeyGuard` - API key validation (for MCP/programmatic access)
- `ApiKeyThrottleGuard` - Rate limiting by API key
- `SuperadminGuard` - Super-admin only
- `DualAuthGuard` - Session + identity verification

### Swagger Decorators

All controller methods should use:
- `@ApiTags('tag')` - Group endpoints
- `@ApiOperation({ summary: '...' })` - Describe endpoint
- `@ApiResponse({ status, description })` - Document responses
- `@ApiBearerAuth()` / `@ApiSecurity('api-key')` - Auth docs

### Prisma / Database

- Schema at `apps/api/prisma/schema.prisma`
- IDs use `cuid()` (not UUID)
- All models have `createdAt` / `updatedAt` timestamps
- Indexes on all foreign keys and frequently queried fields
- Enums: `CalendarProvider`, `ConnectionType`, `VerificationProvider`, `VerificationLevel`
- Seed file at `apps/api/prisma/seed.ts` creates identity types and default widgets

### Validation

- DTOs use `class-validator` decorators (`@IsString()`, `@IsEmail()`, etc.)
- Global `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`
- Implicit type conversion enabled

### Security Patterns

- Passwords: bcryptjs with cost factor 12
- API keys: SHA-256 hashed, stored as hash + prefix
- Rate limiting: Redis-backed, per-IP and per-email
- Account lockout: 5 failures -> 15 min lockout
- OTP expiry: 5 min; magic link expiry: 15 min
- Timing attack prevention: dummy hash comparison on unknown emails
- Helmet security headers enabled
- CORS whitelist: localhost:3000, bolospot.com

### Trust Model (Critical)

- **Non-transitive**: Grants do not chain. Alice -> Bob does NOT mean Alice -> Bob -> Carol.
- **Real-time revocation**: Every request checks the trust graph live. No cached tokens.
- **Fail-closed**: No access by default. Explicit grant required.
- **Relay boundary**: Agent messages pass through Bolo; agents never touch raw tokens or services directly.

## Environment Variables

Required in `apps/api/.env`:
```
DATABASE_URL              # PostgreSQL connection string
JWT_SECRET                # JWT signing key
GOOGLE_CLIENT_ID          # Google OAuth
GOOGLE_CLIENT_SECRET
MICROSOFT_CLIENT_ID       # Microsoft OAuth
MICROSOFT_CLIENT_SECRET
RESEND_API_KEY            # Email service
STRIPE_SECRET_KEY         # Payments
FRONTEND_URL              # For CORS
BOLO_API_KEY              # MCP server auth
REDIS_URL                 # Redis connection
```

MCP server requires:
```
BOLO_API_KEY              # API key for authenticating with Bolo API
BOLO_API_URL              # Base URL of the Bolo API
```

## Key Design Decisions

1. **No workspace root package.json** - Each app/package manages its own dependencies
2. **CommonJS for API** (NestJS default), **ES Modules for MCP server and SDK**
3. **Prisma over TypeORM** - Schema-first, type-safe queries
4. **Session-first auth** with JWT as transitional fallback
5. **Widget system** - Extensible permission categories; third parties can register widgets
6. **Relay pattern** - Agents communicate through Bolo, never directly accessing user services
7. **BullMQ** for background job processing
8. **Luxon** for timezone-aware date/time handling
