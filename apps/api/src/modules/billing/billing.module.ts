import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { UsageService } from './usage.service';
import { UsageGuard } from './usage.guard';

@Module({
  controllers: [BillingController],
  providers: [BillingService, UsageService, UsageGuard, PrismaService],
  exports: [UsageService, UsageGuard, BillingService],
})
export class BillingModule {}
