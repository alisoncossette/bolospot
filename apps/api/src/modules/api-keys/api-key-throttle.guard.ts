import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  SetMetadata,
  Inject,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

// Decorator to set per-endpoint rate limits for verified users
export const RATE_LIMIT_KEY = 'rateLimit';
export const RateLimit = (maxRequests: number, windowSeconds: number) =>
  SetMetadata(RATE_LIMIT_KEY, { maxRequests, windowSeconds });

// Unverified accounts: 5 requests per day across ALL endpoints
const UNVERIFIED_DAILY_LIMIT = 5;
const UNVERIFIED_WINDOW_SECONDS = 86400; // 24 hours

/**
 * Per-API-key rate limiter backed by Redis.
 * - Works across multiple server instances
 * - Survives deploys
 * - Uses atomic INCR + EXPIRE for race-free counting
 *
 * Unverified accounts get 5 requests/day total (bot farm defense).
 * Verified accounts get per-endpoint limits set via @RateLimit().
 *
 * Must be applied AFTER ApiKeyGuard (needs req.apiKey.id and req.apiKeyUser).
 */
@Injectable()
export class ApiKeyThrottleGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyThrottleGuard.name);

  constructor(
    private reflector: Reflector,
    @Inject(REDIS_CLIENT) private redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Only throttle API key requests (not JWT-authenticated dashboard users)
    if (!request.apiKey?.id) {
      return true;
    }

    // If Redis is unavailable or not connected, allow the request through
    if (!this.redis || this.redis.status !== 'ready') {
      return true;
    }

    const keyId = request.apiKey.id;
    const isHumanVerified = request.apiKeyUser?.isHumanVerified === true;

    try {
      // ─── Unverified accounts: 5 requests/day total ─────────────────────
      if (!isHumanVerified) {
        const dailyKey = `throttle:unverified:${keyId}:daily`;
        const count = await this.redis.incr(dailyKey);

        // Set TTL on first request of the window
        if (count === 1) {
          await this.redis.expire(dailyKey, UNVERIFIED_WINDOW_SECONDS);
        }

        if (count > UNVERIFIED_DAILY_LIMIT) {
          const ttl = await this.redis.ttl(dailyKey);
          this.logger.warn(`Unverified rate limit: key ${keyId} (${count}/${UNVERIFIED_DAILY_LIMIT} daily)`);
          throw new HttpException(
            {
              statusCode: HttpStatus.TOO_MANY_REQUESTS,
              message: `Unverified account: max ${UNVERIFIED_DAILY_LIMIT} requests per day. Verify your identity for higher limits.`,
              retryAfter: ttl > 0 ? ttl : UNVERIFIED_WINDOW_SECONDS,
              verifyUrl: 'https://bolospot.com/dashboard',
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }

      // ─── Verified accounts: per-endpoint limits ────────────────────────
      const limits = this.reflector.get<{ maxRequests: number; windowSeconds: number }>(
        RATE_LIMIT_KEY,
        context.getHandler(),
      ) || { maxRequests: 60, windowSeconds: 60 };

      const endpoint = `${request.method}:${request.route?.path || request.url}`;
      const redisKey = `throttle:${keyId}:${endpoint}`;

      const count = await this.redis.incr(redisKey);

      // Set TTL on first request of the window
      if (count === 1) {
        await this.redis.expire(redisKey, limits.windowSeconds);
      }

      if (count > limits.maxRequests) {
        const ttl = await this.redis.ttl(redisKey);
        this.logger.warn(`Rate limit: key ${keyId} on ${endpoint} (${count}/${limits.maxRequests})`);
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Rate limit exceeded. Max ${limits.maxRequests} requests per ${limits.windowSeconds}s. Retry after ${ttl}s.`,
            retryAfter: ttl > 0 ? ttl : limits.windowSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      // Re-throw rate limit errors
      if (err instanceof HttpException) throw err;
      // Redis errors → skip rate limiting, allow request through
      this.logger.warn(`Redis error in throttle guard: ${err.message}`);
      return true;
    }

    return true;
  }
}
