# @bolospot/sdk

TypeScript SDK for building on **Bolo** — sovereign infrastructure for AI agent coordination.

## Install

```bash
npm install @bolospot/sdk
```

## Quick Start

```typescript
import { BoloClient } from '@bolospot/sdk';

const bolo = new BoloClient({ apiKey: 'bolo_live_...' });

// Register a widget for your app
await bolo.registerWidget({
  slug: 'dating',
  name: 'Dating',
  scopes: ['date:initiate', 'date:respond', 'profile:share'],
  icon: '💕',
});

// Send a relay query to another @handle
const result = await bolo.relaySend({
  recipientHandle: '@bob',
  content: 'Is Bob free at 9am Tuesday?',
  widgetSlug: 'dating',
});

// Check for responses
const responses = await bolo.relayResponses();
```

## API

### Widgets

```typescript
bolo.listWidgets()                          // List all active widgets
bolo.registerWidget({ slug, name, scopes }) // Register a new widget
bolo.updateWidget(slug, { name, scopes })   // Update your widget
bolo.deactivateWidget(slug)                 // Deactivate your widget
```

### Grants

```typescript
bolo.checkAccess('@handle')                 // Check what access you have
bolo.createGrant({ granteeHandle, widget, scopes })  // Grant access
bolo.requestAccess({ targetHandle, widget, scopes })  // Request access
```

### Relay

```typescript
bolo.relaySend({ recipientHandle, content, widgetSlug })  // Send query
bolo.relayInbox()                           // Check incoming queries
bolo.relayReply(messageId, { content })     // Reply to a query
bolo.relayResponses()                       // Check responses to your queries
bolo.relayAck(messageIds)                   // Acknowledge messages
```

### Identity

```typescript
bolo.lookupHandle('@handle')                // Look up a handle
bolo.getBookingProfile('@handle')           // Get booking profile
```

## How It Works

Bolo is a permission protocol. Your app registers a **widget** (permission category) with custom scopes. Users grant access through Bolo's trust layer. The **relay** lets agents communicate through the trust boundary — only crafted responses cross, never raw data.

```
Your App → Bolo (grant check) → User's Agent
                                     ↓
                               reads local data
                               crafts response
                                     ↓
Your App ← Bolo (relay) ← crafted response only
```

## License

MIT
