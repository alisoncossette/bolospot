import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { AvailabilityController } from './availability.controller';
import { SlotFinderService } from './slot-finder.service';
import { ConnectionsModule } from '../connections/connections.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { GrantsModule } from '../grants/grants.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, ConnectionsModule, ApiKeysModule, GrantsModule, AuthModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService, SlotFinderService],
  exports: [AvailabilityService, SlotFinderService],
})
export class AvailabilityModule {}
