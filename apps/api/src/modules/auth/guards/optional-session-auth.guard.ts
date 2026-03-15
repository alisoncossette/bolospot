import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SessionService } from '../session.service';
import { AuthService } from '../auth.service';

/**
 * Like SessionAuthGuard but doesn't reject unauthenticated requests.
 * Sets req.user to the authenticated user, or null if no valid session/token.
 */
@Injectable()
export class OptionalSessionAuthGuard implements CanActivate {
  constructor(
    private sessionService: SessionService,
    private authService: AuthService,
    private jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    req.user = null;

    // 1. Try session cookie, then X-Session-Id header (cross-domain fallback)
    const sessionId = req.cookies?.['bolo_session'] || req.headers['x-session-id'];
    if (sessionId?.startsWith('bolo_sid_')) {
      const session = await this.sessionService.getSession(sessionId);
      if (session) {
        const user = await this.authService.validateUserById(session.userId);
        if (user) {
          req.user = user;
          this.sessionService.refreshSession(sessionId).catch(() => {});
          return true;
        }
        await this.sessionService.destroySession(sessionId);
      }
    }

    // 2. TRANSITION: Fall back to JWT Bearer token
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
        // Invalid JWT — continue as unauthenticated
      }
    }

    return true; // Always allow — req.user is null for unauthenticated
  }
}
