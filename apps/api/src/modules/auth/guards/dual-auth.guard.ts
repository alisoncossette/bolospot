import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SessionService } from '../session.service';
import { AuthService } from '../auth.service';
import { ApiKeysService } from '../../api-keys/api-keys.service';

/**
 * Tries session auth first, then API key auth. Populates req.user (session)
 * or req.apiKey + req.apiKeyUser (API key). Throws if neither succeeds.
 */
@Injectable()
export class DualAuthGuard implements CanActivate {
  constructor(
    private sessionService: SessionService,
    private authService: AuthService,
    private jwtService: JwtService,
    @Inject(forwardRef(() => ApiKeysService)) private apiKeysService: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // 1. Try session cookie / X-Session-Id
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
      }
    }

    // 2. Try JWT Bearer (transition period)
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
      } catch { /* fall through */ }
    }

    // 3. Try API key
    const apiKey = req.headers['x-api-key']
      || (authHeader?.startsWith('Bearer bolo_') ? authHeader.substring(7) : null);
    if (apiKey) {
      const result = await this.apiKeysService.validateApiKey(apiKey);
      if (result) {
        req.apiKeyUser = result.user;
        req.apiKey = result.apiKey;
        return true;
      }
    }

    throw new UnauthorizedException('Authentication required (session or API key).');
  }
}
