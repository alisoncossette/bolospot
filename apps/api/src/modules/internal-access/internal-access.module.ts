import { Module } from '@nestjs/common';
import { InternalAccessController } from './internal-access.controller';
import { GrantsModule } from '../grants/grants.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [GrantsModule, AuthModule],
  controllers: [InternalAccessController],
})
export class InternalAccessModule {}
