import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { EmailModule } from './modules/email/email.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { IdentityVerificationModule } from './modules/identity-verification/identity-verification.module';
import { HealthModule } from './modules/health/health.module';
import { EventsModule } from './modules/events/events.module';
import { GrantsModule } from './modules/grants/grants.module';
import { BookingModule } from './modules/booking/booking.module';
import { RedisModule } from './modules/redis/redis.module';
import { AdminModule } from './modules/admin/admin.module';
import { InternalAccessModule } from './modules/internal-access/internal-access.module';
import { WidgetsModule } from './modules/widgets/widgets.module';
import { RelayModule } from './modules/relay/relay.module';
import { BillingModule } from './modules/billing/billing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    PrismaModule,
    EmailModule,
    AuthModule,
    UsersModule,
    ConnectionsModule,
    MeetingsModule,
    AvailabilityModule,
    InvitationsModule,
    ApiKeysModule,
    ApprovalsModule,
    ContactsModule,
    IdentityVerificationModule,
    HealthModule,
    EventsModule,
    GrantsModule,
    BookingModule,
    AdminModule,
    InternalAccessModule,
    WidgetsModule,
    RelayModule,
    BillingModule,
  ],
})
export class AppModule {}
