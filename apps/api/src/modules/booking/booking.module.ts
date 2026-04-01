import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { VisitorOAuthService } from './visitor-oauth.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AvailabilityModule } from '../availability/availability.module';
import { ConnectionsModule } from '../connections/connections.module';
import { GrantsModule } from '../grants/grants.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ContactsModule } from '../contacts/contacts.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports: [PrismaModule, AvailabilityModule, ConnectionsModule, GrantsModule, AuthModule, BillingModule, ContactsModule, ApiKeysModule],
  controllers: [BookingController],
  providers: [BookingService, VisitorOAuthService],
  exports: [BookingService],
})
export class BookingModule {}
