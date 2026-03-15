import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  SetMetadata,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsageService } from './usage.service';

// Decorator to tag endpoints with a usage metric
export const USAGE_METRIC_KEY = 'usageMetric';
export const UsageMetric = (metric: string) =>
  SetMetadata(USAGE_METRIC_KEY, metric);

/**
 * Checks plan-level usage limits on API-key-authenticated requests.
 * Must be applied AFTER ApiKeyGuard (needs req.apiKeyUser).
 * Increments the usage counter if the request is allowed.
 */
@Injectable()
export class UsageGuard implements CanActivate {
  private readonly logger = new Logger(UsageGuard.name);

  constructor(
    private reflector: Reflector,
    private usageService: UsageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Only meter API key requests
    if (!request.apiKeyUser?.id) {
      return true;
    }

    const metric = this.reflector.get<string>(
      USAGE_METRIC_KEY,
      context.getHandler(),
    );

    // No metric tag = no metering on this endpoint
    if (!metric) {
      return true;
    }

    const userId = request.apiKeyUser.id;
    const { allowed, current, limit, plan, overage } = await this.usageService.checkLimit(userId, metric);

    if (!allowed) {
      this.logger.warn(`Usage limit: user ${userId} on ${metric} (${current}/${limit}, plan: ${plan})`);
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          message: `Plan limit reached. Your ${plan} plan allows ${limit} ${metric} per month. Upgrade at https://bolospot.com/dashboard/billing`,
          current,
          limit,
          plan,
          upgradeUrl: 'https://bolospot.com/dashboard/billing',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    // Tag overage requests so billing can reconcile later
    if (overage) {
      request.usageOverage = true;
    }

    // Increment usage after allowing
    await this.usageService.increment(userId, metric);

    return true;
  }
}
