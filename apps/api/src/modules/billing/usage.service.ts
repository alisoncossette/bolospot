import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

// Plan limits per month
// hardCap = true: block at limit. false: allow overage (billed later via Stripe).
export const PLAN_LIMITS = {
  FREE:    { relayMessages: 50,    apiCalls: 150,    widgets: 1,  bookingFee: 0.50, hardCap: true },
  PRO:     { relayMessages: 5000,  apiCalls: 25000,  widgets: 10, bookingFee: 0.25, hardCap: true },
  BUILDER: { relayMessages: 25000, apiCalls: 100000, widgets: 50, bookingFee: 0.10, hardCap: false },
} as const;

// Overage rates (Builder plan only)
export const OVERAGE_RATES = {
  relayMessages: 0.02,  // $0.02 per relay message over base
  apiCalls: 0.005,       // $0.005 per API call over base
} as const;

// Per-booking transaction fee applies to ALL plans (metered via Stripe)
// FREE: $0.50/booking, PRO: $0.25/booking, BUILDER: $0.10/booking

export type PlanName = keyof typeof PLAN_LIMITS;

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private prisma: PrismaService) {}

  private currentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async increment(userId: string, metric: string): Promise<number> {
    const period = this.currentPeriod();

    const record = await this.prisma.usageRecord.upsert({
      where: { userId_metric_period: { userId, metric, period } },
      update: { count: { increment: 1 } },
      create: { userId, metric, period, count: 1 },
    });

    return record.count;
  }

  async getUsage(userId: string): Promise<Record<string, number>> {
    const period = this.currentPeriod();
    const records = await this.prisma.usageRecord.findMany({
      where: { userId, period },
    });

    const usage: Record<string, number> = {};
    for (const r of records) {
      usage[r.metric] = r.count;
    }
    return usage;
  }

  async checkLimit(userId: string, metric: string): Promise<{
    allowed: boolean;
    current: number;
    limit: number;
    plan: PlanName;
    overage: boolean;
  }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true },
    });

    const plan = (user.plan || 'FREE') as PlanName;
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.FREE;

    // Bookings are always allowed (metered, not capped)
    if (metric === 'booking') {
      return { allowed: true, current: 0, limit: -1, plan, overage: false };
    }

    // Map metrics to limit keys
    const limitKey = metric.startsWith('relay') ? 'relayMessages' : 'apiCalls';
    const limit = limits[limitKey];

    const period = this.currentPeriod();
    const record = await this.prisma.usageRecord.findUnique({
      where: { userId_metric_period: { userId, metric, period } },
    });

    const current = record?.count || 0;
    const overLimit = current >= limit;

    // Builder plan: allow overage (metered billing)
    if (overLimit && !limits.hardCap) {
      this.logger.log(`Overage: user ${userId} on ${metric} (${current}/${limit}, plan: ${plan})`);
      return { allowed: true, current, limit, plan, overage: true };
    }

    return { allowed: !overLimit, current, limit, plan, overage: false };
  }

  /**
   * Calculate all metered charges for a user in the current period.
   * Includes: booking transaction fees (all plans) + overage (Builder only).
   */
  async getMeteredCharges(userId: string): Promise<{
    bookings: { count: number; rate: number; charge: number };
    overage: { metric: string; overage: number; rate: number; charge: number }[];
    total: number;
  }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true },
    });

    const plan = (user.plan || 'FREE') as PlanName;
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.FREE;
    const usage = await this.getUsage(userId);

    // Booking transaction fees (all plans)
    const bookingCount = usage.booking || 0;
    const bookingRate = limits.bookingFee;
    const bookingCharge = bookingCount * bookingRate;

    // Overage charges (Builder only)
    const overage: { metric: string; overage: number; rate: number; charge: number }[] = [];

    if (plan === 'BUILDER') {
      const relaySent = (usage.relay_send || 0) + (usage.relay_reply || 0);
      if (relaySent > limits.relayMessages) {
        const over = relaySent - limits.relayMessages;
        overage.push({ metric: 'relayMessages', overage: over, rate: OVERAGE_RATES.relayMessages, charge: over * OVERAGE_RATES.relayMessages });
      }

      const apiCalls = usage.api_call || 0;
      if (apiCalls > limits.apiCalls) {
        const over = apiCalls - limits.apiCalls;
        overage.push({ metric: 'apiCalls', overage: over, rate: OVERAGE_RATES.apiCalls, charge: over * OVERAGE_RATES.apiCalls });
      }
    }

    const overageTotal = overage.reduce((sum, o) => sum + o.charge, 0);

    return {
      bookings: { count: bookingCount, rate: bookingRate, charge: bookingCharge },
      overage,
      total: bookingCharge + overageTotal,
    };
  }
}
