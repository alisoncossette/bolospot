import type {
  BoloConfig,
  Widget,
  RegisterWidgetInput,
  UpdateWidgetInput,
  CreateGrantInput,
  Grant,
  AccessCheckResult,
  RequestAccessInput,
  SendQueryInput,
  SendQueryResult,
  ReplyInput,
  ReplyResult,
  InboxResult,
  AckResult,
  BookingProfile,
  HandleLookup,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.bolospot.com';

export class BoloClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: BoloConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  // ─── HTTP layer ───────────────────────────────────────────────────

  private async request<T>(
    endpoint: string,
    options: { method?: string; body?: unknown; params?: Record<string, string | undefined> } = {},
  ): Promise<T> {
    const { method = 'GET', body, params } = options;

    let url = `${this.baseUrl}/api${endpoint}`;
    if (params) {
      const filtered = Object.entries(params).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      );
      if (filtered.length > 0) {
        url += `?${new URLSearchParams(filtered).toString()}`;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let message: string;
      try {
        const parsed = JSON.parse(errorText);
        message = parsed.message || parsed.error || errorText;
      } catch {
        message = errorText;
      }
      throw new BoloError(response.status, message);
    }

    return response.json() as Promise<T>;
  }

  // ─── Widgets ──────────────────────────────────────────────────────

  /** List all active widgets (built-in + registered). */
  async listWidgets(): Promise<Widget[]> {
    return this.request<Widget[]>('/widgets');
  }

  /** Register a new widget for your app. */
  async registerWidget(input: RegisterWidgetInput): Promise<Widget> {
    return this.request<Widget>('/widgets/register', {
      method: 'POST',
      body: input,
    });
  }

  /** Update a registered widget (owner only). */
  async updateWidget(slug: string, input: UpdateWidgetInput): Promise<Widget> {
    return this.request<Widget>(`/widgets/${slug}`, {
      method: 'PATCH',
      body: input,
    });
  }

  /** Deactivate a registered widget (owner only). */
  async deactivateWidget(slug: string): Promise<Widget> {
    return this.request<Widget>(`/widgets/${slug}`, {
      method: 'DELETE',
    });
  }

  // ─── Grants ───────────────────────────────────────────────────────

  /** Create a grant (give someone access to a widget). */
  async createGrant(input: CreateGrantInput): Promise<Grant> {
    return this.request<Grant>('/grants', {
      method: 'POST',
      body: input,
    });
  }

  /** Check what access you have from a @handle. */
  async checkAccess(handle: string): Promise<AccessCheckResult> {
    const clean = handle.replace(/^@/, '').toLowerCase();
    return this.request<AccessCheckResult>(`/@${clean}/access/key`);
  }

  /** Request access to a @handle's widget. */
  async requestAccess(input: RequestAccessInput): Promise<{ id: string; status: string }> {
    return this.request(`/@${input.targetHandle.replace(/^@/, '').toLowerCase()}/access/request/key`, {
      method: 'POST',
      body: input,
    });
  }

  // ─── Relay ────────────────────────────────────────────────────────

  /** Send a query through the relay to another @handle. */
  async relaySend(input: SendQueryInput): Promise<SendQueryResult> {
    return this.request<SendQueryResult>('/relay/send', {
      method: 'POST',
      body: input,
    });
  }

  /** Check your relay inbox for pending queries. */
  async relayInbox(since?: string): Promise<InboxResult> {
    return this.request<InboxResult>('/relay/inbox', {
      params: { since },
    });
  }

  /** Reply to a relay query. */
  async relayReply(messageId: string, input: ReplyInput): Promise<ReplyResult> {
    return this.request<ReplyResult>(`/relay/${messageId}/reply`, {
      method: 'POST',
      body: input,
    });
  }

  /** Check for responses to queries you sent. */
  async relayResponses(since?: string): Promise<InboxResult> {
    return this.request<InboxResult>('/relay/responses', {
      params: { since },
    });
  }

  /** Acknowledge (mark as delivered) relay messages. */
  async relayAck(messageIds: string[]): Promise<AckResult> {
    return this.request<AckResult>('/relay/ack', {
      method: 'POST',
      body: { messageIds },
    });
  }

  // ─── Identity ─────────────────────────────────────────────────────

  /** Look up a @handle. */
  async lookupHandle(handle: string): Promise<HandleLookup> {
    const clean = handle.replace(/^@/, '').toLowerCase();
    return this.request<HandleLookup>(`/@${clean}/lookup`);
  }

  /** Get a @handle's booking profile. */
  async getBookingProfile(handle: string): Promise<BookingProfile> {
    const clean = handle.replace(/^@/, '').toLowerCase();
    return this.request<BookingProfile>(`/@${clean}/booking/profile`);
  }
}

// ─── Error class ────────────────────────────────────────────────────

export class BoloError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'BoloError';
  }
}