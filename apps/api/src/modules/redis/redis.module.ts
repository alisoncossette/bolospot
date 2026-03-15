import { Module, Global, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const logger = new Logger('RedisModule');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        if (!url) {
          logger.warn('REDIS_URL not set — Redis features disabled');
          return null;
        }
        const redis = new Redis(url, {
          maxRetriesPerRequest: 1,
          connectTimeout: 5000,
          retryStrategy: (times) => {
            if (times > 2) {
              logger.warn('Redis connection failed after retries — giving up');
              return null; // stop retrying
            }
            return Math.min(times * 500, 2000);
          },
          lazyConnect: true,
        });
        redis.on('error', (err) => {
          logger.warn(`Redis error: ${err.message}`);
        });
        // Attempt to connect, but don't block startup if it fails
        redis.connect().catch((err) => {
          logger.warn(`Redis connect failed: ${err.message} — Redis features disabled`);
        });
        return redis;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
