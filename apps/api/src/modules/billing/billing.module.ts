import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { UsageService } from './usage.service';
import { UsageGuard } from './usage.guard';

@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [BillingService, UsageService, UsageGuard, PrismaService],
  exports: [UsageService, UsageGuard, BillingService],
})
export class BillingModule {}
