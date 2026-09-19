// src/modules/auth/auth.module.ts

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { UsersModule } from '../users/users.module';

const DEV_JWT_SECRET = 'dev-only-insecure-secret-change-me';

// The dev fallback is a publicly known string — anyone could mint a valid
// SUPER_ADMIN token with it — so a production boot must refuse to use it.
function resolveJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET', DEV_JWT_SECRET);
  if (
    config.get<string>('NODE_ENV') === 'production' &&
    (secret === DEV_JWT_SECRET || secret.length < 32)
  ) {
    throw new Error(
      'JWT_SECRET must be set to a random string of at least 32 characters in production',
    );
  }
  return secret;
}

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: resolveJwtSecret(config),
        signOptions: { expiresIn: '15m' },
      }),
    }),
    // Applied only to /auth/login and /auth/refresh via
    // @UseGuards(ThrottlerGuard) + @Throttle() on those handlers (not
    // globally) — see auth.controller.ts.
    ThrottlerModule.forRoot([{ name: 'auth', ttl: 60_000, limit: 5 }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, RolesGuard],
  exports: [AuthService, AuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
