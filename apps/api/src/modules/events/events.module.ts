import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { GoogleCalendarProvider } from '../../providers/google/google-calendar.provider';
import { MicrosoftCalendarProvider } from '../../providers/microsoft/microsoft-calendar.provider';
import { AuthModule } from '../auth/auth.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { GrantsModule } from '../grants/grants.module';
import { ConnectionsModule } from '../connections/connections.module';

@Module({
  imports: [PrismaModule, AuthModule, ApiKeysModule, GrantsModule, ConnectionsModule],
  controllers: [EventsController],
  providers: [EventsService, GoogleCalendarProvider, MicrosoftCalendarProvider],
  exports: [EventsService],
})
export class EventsModule {}
