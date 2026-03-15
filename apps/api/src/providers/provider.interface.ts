import { CalendarProvider } from '@prisma/client';

/**
 * Normalized time slot representation
 */
export interface TimeSlot {
  startTime: Date;
  endTime: Date;
  timezone: string;
}

/**
 * Normalized calendar event
 */
export interface NormalizedEvent {
  id: string;
  title?: string;
  description?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  isAllDay: boolean;
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  showAs: 'BUSY' | 'FREE' | 'TENTATIVE' | 'OOO';
  isRecurring: boolean;
  recurrenceRule?: string;
}

/**
 * Normalized calendar representation
 */
export interface NormalizedCalendar {
  id: string;
  name: string;
  description?: string;
  color?: string;
  isPrimary: boolean;
  accessRole?: string;
}

/**
 * OAuth tokens
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  tokenType?: string;
  scope?: string;
}

/**
 * Webhook subscription info
 */
export interface WebhookSubscription {
  channelId: string;
  resourceId?: string;
  expiration: Date;
}

/**
 * Provider connection credentials
 */
export interface ProviderCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
  // For CalDAV (Apple)
  caldavUrl?: string;
  caldavUsername?: string;
  caldavPassword?: string;
  // For link-based (Calendly/Cal.com)
  bookingLink?: string;
}

/**
 * Common interface for all calendar providers
 * Each provider (Google, Microsoft, Apple, Calendly, Cal.com) implements this
 */
export interface ICalendarProvider {
  /**
   * Provider identifier
   */
  readonly provider: CalendarProvider;

  /**
   * Get OAuth authorization URL
   * @param state CSRF token
   * @param redirectUri Callback URL
   */
  getAuthorizationUrl(state: string, redirectUri: string): string;

  /**
   * Exchange authorization code for tokens
   * @param code Authorization code from OAuth callback
   * @param redirectUri Callback URL (must match)
   */
  exchangeCodeForTokens(
    code: string,
    redirectUri: string,
  ): Promise<OAuthTokens>;

  /**
   * Refresh expired access token
   * @param refreshToken Refresh token
   */
  refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;

  /**
   * List all calendars for the connected account
   * @param credentials Provider credentials
   */
  listCalendars(credentials: ProviderCredentials): Promise<NormalizedCalendar[]>;

  /**
   * Fetch events from a calendar within a date range
   * @param credentials Provider credentials
   * @param calendarId Calendar ID
   * @param startTime Start of date range
   * @param endTime End of date range
   */
  fetchEvents(
    credentials: ProviderCredentials,
    calendarId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<NormalizedEvent[]>;

  /**
   * Get free/busy information (if supported)
   * Some providers have dedicated free/busy APIs that are more efficient
   * @param credentials Provider credentials
   * @param calendarIds Calendar IDs to check
   * @param startTime Start of date range
   * @param endTime End of date range
   */
  getFreeBusy?(
    credentials: ProviderCredentials,
    calendarIds: string[],
    startTime: Date,
    endTime: Date,
  ): Promise<TimeSlot[]>;

  /**
   * Create a calendar event
   * @param credentials Provider credentials
   * @param calendarId Calendar ID
   * @param event Event details
   */
  createEvent(
    credentials: ProviderCredentials,
    calendarId: string,
    event: {
      title: string;
      description?: string;
      location?: string;
      startTime: Date;
      endTime: Date;
      timezone: string;
      attendees?: { email: string; name?: string }[];
    },
  ): Promise<{ id: string; link?: string }>;

  /**
   * Subscribe to calendar changes via webhook (if supported)
   * @param credentials Provider credentials
   * @param calendarId Calendar ID
   * @param webhookUrl URL to receive notifications
   */
  subscribeToChanges?(
    credentials: ProviderCredentials,
    calendarId: string,
    webhookUrl: string,
  ): Promise<WebhookSubscription>;

  /**
   * Unsubscribe from calendar changes
   * @param credentials Provider credentials
   * @param channelId Subscription channel ID
   * @param resourceId Resource ID (provider-specific)
   */
  unsubscribeFromChanges?(
    credentials: ProviderCredentials,
    channelId: string,
    resourceId?: string,
  ): Promise<void>;

  /**
   * Incremental sync - fetch only changes since last sync
   * @param credentials Provider credentials
   * @param calendarId Calendar ID
   * @param syncToken Token from previous sync
   */
  syncChanges?(
    credentials: ProviderCredentials,
    calendarId: string,
    syncToken?: string,
  ): Promise<{
    events: NormalizedEvent[];
    deletedEventIds: string[];
    nextSyncToken: string;
  }>;
}

/**
 * Factory to get the appropriate provider implementation
 */
export interface ICalendarProviderFactory {
  getProvider(provider: CalendarProvider): ICalendarProvider;
}
