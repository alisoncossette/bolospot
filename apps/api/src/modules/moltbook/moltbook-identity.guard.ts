import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { MoltbookService } from './moltbook.service';

/**
 * Guard that authenticates requests using a Moltbook identity token.
 * Extracts the token from the X-Moltbook-Identity header,
 * verifies it with Moltbook, and resolves/creates a Bolo user.
 */
@Injectable()
export class MoltbookIdentityGuard implements CanActivate {
  constructor(private moltbookService: MoltbookService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Moltbook identity token required');
    }

    // Verify the token with Moltbook
    const agent = await this.moltbookService.verifyIdentityToken(token);
    if (!agent) {
      throw new UnauthorizedException('Invalid or expired Moltbook identity token');
    }

    // Resolve to a Bolo user (auto-create if first time)
    const user = await this.moltbookService.resolveOrCreateUser(agent);
    if (!user) {
      throw new UnauthorizedException('Failed to resolve Moltbook agent to Bolo user');
    }

    // Attach to request — same shape as ApiKeyGuard for compatibility
    request.apiKeyUser = user;
    request.moltbookAgent = agent;
    request.apiKey = {
      id: `moltbook:${agent.id}`,
      permissions: this.karmaToPermissions(agent.karma),
    };

    return true;
  }

  private extractToken(request: any): string | null {
    return request.headers['x-moltbook-identity'] || null;
  }

  /**
   * Higher karma agents get broader default permissions.
   */
  private karmaToPermissions(karma: number): string[] {
    const base = ['availability:read', 'handle:lookup', 'grants:read'];

    if (karma >= 10) {
      base.push('meetings:request', 'booking:read');
    }

    if (karma >= 100) {
      base.push('meetings:create');
    }

    return base;
  }
}
