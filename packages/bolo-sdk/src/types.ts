// ─── Core types ─────────────────────────────────────────────────────

export interface BoloConfig {
  apiKey: string;
  baseUrl?: string;
}

// ─── Widgets ────────────────────────────────────────────────────────

export interface Widget {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  scopes: string[];
  registeredById: string | null;
  createdAt: string;
}

export interface RegisterWidgetInput {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  scopes: string[];
  callbackUrl?: string;
}

export interface UpdateWidgetInput {
  name?: string;
  description?: string;
  icon?: string;
  scopes?: string[];
}

// ─── Grants ─────────────────────────────────────────────────────────

export interface Grant {
  id: string;
  grantorHandle: string;
  granteeHandle: string;
  widget: string;
  scopes: string[];
  note: string | null;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateGrantInput {
  granteeHandle: string;
  widget: string;
  scopes: string[];
  note?: string;
  expiresAt?: string;
}

export interface AccessCheckResult {
  exists: boolean;
  handle: string;
  widgets: Array<{
    slug: string;
    name: string;
    status: 'granted' | 'no_access';
    scopes: string[];
  }>;
  pendingRequests: Array<{
    id: string;
    widget: string;
    status: string;
  }>;
}

export interface RequestAccessInput {
  targetHandle: string;
  widget: string;
  scopes: string[];
  reason?: string;
}

// ─── Relay ──────────────────────────────────────────────────────────

export interface RelayMessage {
  id: string;
  senderHandle: string;
  recipientHandle?: string;
  parentMessageId?: string;
  widgetSlug: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  conversationId: string | null;
  status: 'PENDING' | 'DELIVERED' | 'EXPIRED';
  createdAt: string;
  expiresAt?: string;
}

export interface SendQueryInput {
  recipientHandle: string;
  content: string;
  widgetSlug?: string;
  scope?: string;
  metadata?: Record<string, unknown>;
  conversationId?: string;
}

export interface SendQueryResult {
  id: string;
  conversationId: string | null;
  status: string;
  expiresAt: string;
}

export interface ReplyInput {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ReplyResult {
  id: string;
  parentMessageId: string;
  conversationId: string | null;
  status: string;
}

export interface InboxResult {
  messages: RelayMessage[];
  count: number;
}

export interface AckResult {
  acknowledged: number;
}

// ─── Availability ───────────────────────────────────────────────────

export interface BookingProfile {
  handle: string;
  name: string | null;
  timezone: string;
  workingHoursStart: number;
  workingHoursEnd: number;
  workingDays: number[];
  allowedDurations: number[];
}

export interface HandleLookup {
  exists: boolean;
  handle: string;
  name: string | null;
  isHumanVerified: boolean;
}
