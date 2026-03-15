import { Module } from '@nestjs/common';
import { ConnectionsService } from './connections.service';
import { ConnectionsController } from './connections.controller';
import { GoogleCalendarProvider } from '../../providers/google/google-calendar.provider';
import { MicrosoftCalendarProvider } from '../../providers/microsoft/microsoft-calendar.provider';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { BusyBlockSyncJob } from './busy-block-sync.job';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService, GoogleCalendarProvider, MicrosoftCalendarProvider, BusyBlockSyncJob],
  exports: [ConnectionsService, GoogleCalendarProvider, MicrosoftCalendarProvider],
})
export class ConnectionsModule {}
