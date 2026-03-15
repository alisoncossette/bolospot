import { Module } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { MeetingsController } from './meetings.controller';
import { AvailabilityModule } from '../availability/availability.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { ConnectionsModule } from '../connections/connections.module';
import { ContactsModule } from '../contacts/contacts.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AvailabilityModule, EmailModule, ConnectionsModule, ContactsModule, AuthModule],
  controllers: [MeetingsController],
  providers: [MeetingsService],
  exports: [MeetingsService],
})
export class MeetingsModule {}
