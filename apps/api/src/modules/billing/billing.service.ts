import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import Stripe from 'stripe';
import { PlanName, PLAN_LIMITS } from './usage.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private stripe: Stripe | null = null;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (key) {
      this.stripe = new Stripe(key, { apiVersion: '2025-01-27.acacia' });
    } else {
      this.logger.warn('STRIPE_SECRET_KEY not set — billing disabled');
    }
  }

  async createCheckoutSession(userId: string, plan: 'PRO' | 'BUILDER'): Promise<{ url: string }> {
    if (!this.stripe) throw new Error('Billing not configured');

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, stripeCustomerId: true, handle: true },
    });

    // Get or create Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: user.email,
        metadata: { boloUserId: userId, boloHandle: user.handle },
      });
      customerId = customer.id;
      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    const priceId = plan === 'PRO'
      ? this.config.get<string>('STRIPE_PRO_PRICE_ID')
      : this.config.get<string>('STRIPE_BUILDER_PRICE_ID');

    if (!priceId) throw new Error(`Price ID not configured for ${plan}`);

    const frontendUrl = this.config.get<string>('FRONTEND_URL') || 'https://bolospot.com';

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}/dashboard/billing?success=true`,
      cancel_url: `${frontendUrl}/dashboard/billing?canceled=true`,
      metadata: { boloUserId: userId, boloPlan: plan },
    });

    return { url: session.url! };
  }

  async createPortalSession(userId: string): Promise<{ url: string }> {
    if (!this.stripe) throw new Error('Billing not configured');

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });

    if (!user.stripeCustomerId) {
      throw new Error('No billing account. Subscribe to a plan first.');
    }

    const frontendUrl = this.config.get<string>('FRONTEND_URL') || 'https://bolospot.com';

    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${frontendUrl}/dashboard/billing`,
    });

    return { url: session.url };
  }

  async handleWebhook(body: Buffer, signature: string): Promise<void> {
    if (!this.stripe) return;

    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      this.logger.warn('STRIPE_WEBHOOK_SECRET not set — ignoring webhook');
      return;
    }

    const event = this.stripe.webhooks.constructEvent(body, signature, webhookSecret);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.boloUserId;
        const plan = session.metadata?.boloPlan as PlanName;
        if (userId && plan) {
          await this.prisma.user.update({
            where: { id: userId },
            data: {
              plan,
              stripeSubscriptionId: session.subscription as string,
            },
          });
          this.logger.log(`User ${userId} upgraded to ${plan}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const user = await this.prisma.user.findFirst({
          where: { stripeSubscriptionId: sub.id },
        });
        if (user) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { plan: 'FREE', stripeSubscriptionId: null },
          });
          this.logger.log(`User ${user.id} downgraded to FREE (subscription canceled)`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        if (sub.status === 'past_due' || sub.status === 'unpaid') {
          const user = await this.prisma.user.findFirst({
            where: { stripeSubscriptionId: sub.id },
          });
          if (user) {
            this.logger.warn(`User ${user.id} subscription ${sub.status}`);
          }
        }
        break;
      }
    }
  }

  async getPlanDetails(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { plan: true, stripeCustomerId: true, stripeSubscriptionId: true },
    });

    const plan = (user.plan || 'FREE') as PlanName;
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.FREE;

    return {
      plan,
      limits,
      hasSubscription: !!user.stripeSubscriptionId,
      canManageBilling: !!user.stripeCustomerId,
    };
  }
}
