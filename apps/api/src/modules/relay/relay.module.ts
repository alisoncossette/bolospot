import { Module } from '@nestjs/common';
import { RelayService } from './relay.service';
import { RelayController } from './relay.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { GrantsModule } from '../grants/grants.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [PrismaModule, ApiKeysModule, GrantsModule, BillingModule],
  controllers: [RelayController],
  providers: [RelayService],
  exports: [RelayService],
})
export class RelayModule {}
