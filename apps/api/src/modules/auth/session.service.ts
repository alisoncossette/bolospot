import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import { REDIS_CLIENT } from '../redis/redis.module';
import Redis from 'ioredis';
import * as crypto from 'crypto';

const SESSION_TTL = 604800; // 7 days in seconds
const MAX_SESSIONS_PER_USER = 5;

export interface SessionData {
  userId: string;
  email: string;
  handle: string;
  createdAt: number;
  lastActiveAt: number;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Optional() @Inject(REDIS_CLIENT) private redis: Redis | null,
  ) {}

  /**
   * Create a new session in Redis. Enforces max 5 concurrent sessions per user.
   * Returns the session ID (to be set as cookie value).
   */
  async createSession(userId: string, userData: Omit<SessionData, 'createdAt' | 'lastActiveAt'>): Promise<string> {
    if (!this.redis) {
      throw new Error('Redis unavailable — cannot create session');
    }

    const sessionId = `bolo_sid_${crypto.randomBytes(32).toString('hex')}`;
    const now = Date.now();

    const session: SessionData = {
      ...userData,
      createdAt: now,
      lastActiveAt: now,
    };

    await this.redis.set(
      `session:${sessionId}`,
      JSON.stringify(session),
      'EX',
      SESSION_TTL,
    );

    // Track session in user's session set
    await this.redis.sadd(`user_sessions:${userId}`, sessionId);

    // Enforce max sessions per user
    await this.enforceSessionLimit(userId);

    this.logger.log(`Session created for @${userData.handle}`);
    return sessionId;
  }

  /**
   * Look up a session by ID. Returns null if not found or expired.
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    if (!this.redis) return null;

    try {
      const data = await this.redis.get(`session:${sessionId}`);
      if (!data) return null;
      return JSON.parse(data) as SessionData;
    } catch (err) {
      this.logger.warn(`Failed to get session: ${err}`);
      return null;
    }
  }

  /**
   * Refresh session TTL (sliding window). Fire-and-forget.
   */
  async refreshSession(sessionId: string): Promise<void> {
    if (!this.redis) return;

    try {
      const data = await this.redis.get(`session:${sessionId}`);
      if (!data) return;

      const session: SessionData = JSON.parse(data);
      session.lastActiveAt = Date.now();

      await this.redis.set(
        `session:${sessionId}`,
        JSON.stringify(session),
        'EX',
        SESSION_TTL,
      );
    } catch (err) {
      this.logger.warn(`Failed to refresh session: ${err}`);
    }
  }

  /**
   * Destroy a single session.
   */
  async destroySession(sessionId: string): Promise<void> {
    if (!this.redis) return;

    try {
      // Get session to find userId for cleanup
      const data = await this.redis.get(`session:${sessionId}`);
      if (data) {
        const session: SessionData = JSON.parse(data);
        await this.redis.srem(`user_sessions:${session.userId}`, sessionId);
      }
      await this.redis.del(`session:${sessionId}`);
    } catch (err) {
      this.logger.warn(`Failed to destroy session: ${err}`);
    }
  }

  /**
   * Destroy all sessions for a user (logout everywhere).
   */
  async destroyAllUserSessions(userId: string): Promise<void> {
    if (!this.redis) return;

    try {
      const sessionIds = await this.redis.smembers(`user_sessions:${userId}`);
      if (sessionIds.length > 0) {
        const keys = sessionIds.map((id) => `session:${id}`);
        await this.redis.del(...keys);
      }
      await this.redis.del(`user_sessions:${userId}`);
      this.logger.log(`Destroyed ${sessionIds.length} sessions for user ${userId}`);
    } catch (err) {
      this.logger.warn(`Failed to destroy all sessions: ${err}`);
    }
  }

  /**
   * Enforce max sessions per user. Evicts oldest sessions if over limit.
   */
  private async enforceSessionLimit(userId: string): Promise<void> {
    if (!this.redis) return;

    try {
      const sessionIds = await this.redis.smembers(`user_sessions:${userId}`);

      // Clean up expired sessions from the set
      const validSessions: { id: string; createdAt: number }[] = [];
      for (const id of sessionIds) {
        const data = await this.redis.get(`session:${id}`);
        if (data) {
          const session: SessionData = JSON.parse(data);
          validSessions.push({ id, createdAt: session.createdAt });
        } else {
          // Session expired — remove from set
          await this.redis.srem(`user_sessions:${userId}`, id);
        }
      }

      // If over limit, evict oldest
      if (validSessions.length > MAX_SESSIONS_PER_USER) {
        validSessions.sort((a, b) => a.createdAt - b.createdAt);
        const toEvict = validSessions.slice(0, validSessions.length - MAX_SESSIONS_PER_USER);
        for (const session of toEvict) {
          await this.redis.del(`session:${session.id}`);
          await this.redis.srem(`user_sessions:${userId}`, session.id);
        }
        this.logger.log(`Evicted ${toEvict.length} oldest sessions for user ${userId}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to enforce session limit: ${err}`);
    }
  }
}
