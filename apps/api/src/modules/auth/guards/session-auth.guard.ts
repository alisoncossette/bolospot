import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SessionService } from '../session.service';
import { AuthService } from '../auth.service';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private sessionService: SessionService,
    private authService: AuthService,
    private jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // 1. Try session cookie first, then X-Session-Id header (cross-domain fallback)
    const sessionId = req.cookies?.['bolo_session'] || req.headers['x-session-id'];
    if (sessionId?.startsWith('bolo_sid_')) {
      const session = await this.sessionService.getSession(sessionId);
      if (session) {
        const user = await this.authService.validateUserById(session.userId);
        if (user) {
          req.user = user;
          // Refresh TTL (fire-and-forget)
          this.sessionService.refreshSession(sessionId).catch(() => {});
          return true;
        }
        // Session exists but user deleted — destroy stale session
        await this.sessionService.destroySession(sessionId);
      }
    }

    // 2. TRANSITION: Fall back to JWT Bearer token
    //    Remove this block after frontend migration is deployed
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ') && !authHeader.includes('bolo_live_')) {
      try {
        const token = authHeader.slice(7);
        const payload = this.jwtService.verify(token);
        const user = await this.authService.validateUserById(payload.sub);
        if (user) {
          req.user = user;
          return true;
        }
      } catch {
        // Invalid JWT — fall through to throw
      }
    }

    throw new UnauthorizedException();
  }
}
