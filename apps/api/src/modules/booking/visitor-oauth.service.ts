import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import { REDIS_CLIENT } from '../redis/redis.module';
import { GoogleCalendarProvider } from '../../providers/google/google-calendar.provider';
import { MicrosoftCalendarProvider } from '../../providers/microsoft/microsoft-calendar.provider';

interface VisitorSession {
  sessionId: string;
  provider: 'google' | 'microsoft';
  accessToken: string;
  email: string;
  expiresAt: number; // unix ms
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const REDIS_PREFIX = 'visitor-oauth:';

@Injectable()
export class VisitorOAuthService {
  private readonly logger = new Logger(VisitorOAuthService.name);
  private readonly hmacSecret: string;
  private readonly apiUrl: string;

  // In-memory fallback when Redis is unavailable
  private readonly memoryStore = new Map<string, VisitorSession>();

  constructor(
    private configService: ConfigService,
    private googleProvider: GoogleCalendarProvider,
    private microsoftProvider: MicrosoftCalendarProvider,
    @Inject(REDIS_CLIENT) private redis: any | null,
  ) {
    this.hmacSecret = this.configService.get<string>('JWT_SECRET') || 'visitor-oauth-secret';
    this.apiUrl = this.configService.get<string>('API_URL') || 'https://api.bolospot.com';
  }

  /**
   * Start OAuth flow for a visitor. Returns a sessionId and the OAuth URL.
   */
  async startOAuth(
    provider: 'google' | 'microsoft',
    hostHandle: string,
    redirectUrl: string,
  ): Promise<{ sessionId: string; authUrl: string }> {
    const sessionId = randomBytes(16).toString('hex');

    // HMAC-signed state to prevent CSRF
    const statePayload = JSON.stringify({ sessionId, provider, hostHandle, redirectUrl });
    const signature = createHmac('sha256', this.hmacSecret).update(statePayload).digest('hex');
    const state = Buffer.from(JSON.stringify({ payload: statePayload, sig: signature })).toString('base64');

    const callbackUrl = `${this.apiUrl}/api/booking/visitor-auth/callback`;

    let authUrl: string;

    if (provider === 'google') {
      const clientId = this.configService.get('GOOGLE_CLIENT_ID');
      const scopes = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email';

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: scopes,
        access_type: 'online', // No refresh token — ephemeral
        prompt: 'consent',
        state,
      });
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    } else {
      const clientId = this.configService.get('MICROSOFT_CLIENT_ID');
      const scopes = 'User.Read Calendars.Read';

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        response_type: 'code',
        scope: scopes,
        response_mode: 'query',
        state,
      });
      authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
    }

    return { sessionId, authUrl };
  }

  /**
   * Handle OAuth callback. Exchanges code for token, stores session, returns redirect URL.
   */
  async handleCallback(
    code: string,
    stateBase64: string,
  ): Promise<{ redirectUrl: string; sessionId: string; email: string }> {
    // Verify HMAC signature
    let stateObj: { payload: string; sig: string };
    try {
      stateObj = JSON.parse(Buffer.from(stateBase64, 'base64').toString());
    } catch {
      throw new BadRequestException('Invalid state parameter');
    }

    const expectedSig = createHmac('sha256', this.hmacSecret).update(stateObj.payload).digest('hex');
    if (expectedSig !== stateObj.sig) {
      throw new BadRequestException('Invalid state signature');
    }

    const { sessionId, provider, redirectUrl } = JSON.parse(stateObj.payload);
    const callbackUrl = `${this.apiUrl}/api/booking/visitor-auth/callback`;

    let accessToken: string;
    let email: string;
    let expiresIn: number;

    if (provider === 'google') {
      const clientId = this.configService.get('GOOGLE_CLIENT_ID');
      const clientSecret = this.configService.get('GOOGLE_CLIENT_SECRET');

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenResponse.ok) {
        this.logger.error(`Google token exchange failed: ${await tokenResponse.text()}`);
        throw new BadRequestException('Failed to connect Google calendar');
      }

      const tokens = await tokenResponse.json();
      accessToken = tokens.access_token;
      expiresIn = tokens.expires_in || 3600;

      // Get email
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const profile = await profileRes.json();
      email = profile.email || 'visitor';
    } else {
      const clientId = this.configService.get('MICROSOFT_CLIENT_ID');
      const clientSecret = this.configService.get('MICROSOFT_CLIENT_SECRET');

      const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code',
          scope: 'User.Read Calendars.Read',
        }),
      });

      if (!tokenResponse.ok) {
        this.logger.error(`Microsoft token exchange failed: ${await tokenResponse.text()}`);
        throw new BadRequestException('Failed to connect Microsoft calendar');
      }

      const tokens = await tokenResponse.json();
      accessToken = tokens.access_token;
      expiresIn = tokens.expires_in || 3600;

      // Get email
      const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const profile = await profileRes.json();
      email = profile.mail || profile.userPrincipalName || 'visitor';
    }

    // Store session
    const session: VisitorSession = {
      sessionId,
      provider,
      accessToken,
      email,
      expiresAt: Date.now() + Math.min(expiresIn * 1000, SESSION_TTL_MS),
    };

    await this.storeSession(session);

    // Build redirect URL with session info
    const url = new URL(redirectUrl);
    url.searchParams.set('visitorSession', sessionId);
    url.searchParams.set('visitorEmail', email);

    return { redirectUrl: url.toString(), sessionId, email };
  }

  /**
   * Get visitor's busy periods from their connected calendar.
   */
  async getVisitorBusyPeriods(
    sessionId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Array<{ startTime: Date; endTime: Date; source: string }>> {
    const session = await this.getSession(sessionId);
    if (!session) {
      this.logger.log(`Visitor session ${sessionId} not found or expired`);
      return [];
    }

    try {
      let busyMap: Map<string, Array<{ start: Date; end: Date }>>;

      if (session.provider === 'google') {
        busyMap = await this.googleProvider.getFreeBusy(
          session.accessToken,
          ['primary'],
          startDate,
          endDate,
        );
      } else {
        busyMap = await this.microsoftProvider.getFreeBusy(
          session.accessToken,
          ['me'],
          startDate,
          endDate,
        );
      }

      // Flatten all calendars' busy periods
      const periods: Array<{ startTime: Date; endTime: Date; source: string }> = [];
      for (const [, slots] of busyMap) {
        for (const slot of slots) {
          periods.push({
            startTime: slot.start,
            endTime: slot.end,
            source: `visitor:${session.email}`,
          });
        }
      }
      return periods;
    } catch (err) {
      this.logger.error(`Failed to get visitor busy periods: ${err}`);
      return [];
    }
  }

  /**
   * Destroy a visitor session.
   */
  async destroySession(sessionId: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(`${REDIS_PREFIX}${sessionId}`);
      } catch {
        // fallback
      }
    }
    this.memoryStore.delete(sessionId);
  }

  // ─── Internal storage ─────────────────────────────────

  private async storeSession(session: VisitorSession): Promise<void> {
    const ttlSeconds = Math.ceil(SESSION_TTL_MS / 1000);
    const data = JSON.stringify(session);

    if (this.redis) {
      try {
        await this.redis.set(`${REDIS_PREFIX}${session.sessionId}`, data, 'EX', ttlSeconds);
        return;
      } catch (err) {
        this.logger.warn(`Redis store failed, using memory: ${err}`);
      }
    }

    // Memory fallback
    this.memoryStore.set(session.sessionId, session);
    setTimeout(() => this.memoryStore.delete(session.sessionId), SESSION_TTL_MS);
  }

  private async getSession(sessionId: string): Promise<VisitorSession | null> {
    // Try Redis first
    if (this.redis) {
      try {
        const data = await this.redis.get(`${REDIS_PREFIX}${sessionId}`);
        if (data) {
          const session: VisitorSession = JSON.parse(data);
          if (session.expiresAt > Date.now()) return session;
          return null;
        }
      } catch (err) {
        this.logger.warn(`Redis get failed, trying memory: ${err}`);
      }
    }

    // Memory fallback
    const session = this.memoryStore.get(sessionId);
    if (session && session.expiresAt > Date.now()) return session;
    this.memoryStore.delete(sessionId);
    return null;
  }
}
