import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { OptionalSessionAuthGuard } from './guards/optional-session-auth.guard';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    // Keep Passport + JWT during transition (used by SessionAuthGuard fallback)
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN', '7d'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService, JwtStrategy, SessionAuthGuard, OptionalSessionAuthGuard],
  exports: [AuthService, SessionService, JwtModule, SessionAuthGuard, OptionalSessionAuthGuard],
})
export class AuthModule {}
