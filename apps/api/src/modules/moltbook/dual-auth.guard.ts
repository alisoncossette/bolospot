import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { MoltbookService } from './moltbook.service';

/**
 * Accepts EITHER a Bolo API key OR a Moltbook identity token.
 * Tries Moltbook first (X-Moltbook-Identity header), then falls back to API key.
 * This lets existing API key users keep working while adding Moltbook auth.
 */
@Injectable()
export class DualAuthGuard implements CanActivate {
  constructor(
    private apiKeysService: ApiKeysService,
    private moltbookService: MoltbookService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Try Moltbook identity token first
    const moltbookToken = request.headers['x-moltbook-identity'];
    if (moltbookToken) {
      return this.authenticateWithMoltbook(request, moltbookToken);
    }

    // Fall back to Bolo API key
    const apiKey = this.extractApiKey(request);
    if (apiKey) {
      return this.authenticateWithApiKey(request, apiKey);
    }

    throw new UnauthorizedException(
      'Authentication required. Provide either X-Moltbook-Identity header or X-API-Key / Bearer bolo_live_... header.',
    );
  }

  private async authenticateWithMoltbook(request: any, token: string): Promise<boolean> {
    const agent = await this.moltbookService.verifyIdentityToken(token);
    if (!agent) {
      throw new UnauthorizedException('Invalid or expired Moltbook identity token');
    }

    const user = await this.moltbookService.resolveOrCreateUser(agent);
    if (!user) {
      throw new UnauthorizedException('Failed to resolve Moltbook agent');
    }

    request.apiKeyUser = user;
    request.moltbookAgent = agent;
    request.apiKey = {
      id: `moltbook:${agent.id}`,
      permissions: this.karmaToPermissions(agent.karma),
    };
    request.authMethod = 'moltbook';

    return true;
  }

  private async authenticateWithApiKey(request: any, key: string): Promise<boolean> {
    const result = await this.apiKeysService.validateApiKey(key);
    if (!result) {
      throw new UnauthorizedException('Invalid or expired API key');
    }

    request.apiKeyUser = result.user;
    request.apiKey = result.apiKey;
    request.authMethod = 'api_key';

    return true;
  }

  private extractApiKey(request: any): string | null {
    const xApiKey = request.headers['x-api-key'];
    if (xApiKey) return xApiKey;

    const authHeader = request.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer bolo_')) {
      return authHeader.substring(7);
    }

    return null;
  }

  private karmaToPermissions(karma: number): string[] {
    const base = ['availability:read', 'handle:lookup', 'grants:read'];
    if (karma >= 10) base.push('meetings:request', 'booking:read');
    if (karma >= 100) base.push('meetings:create');
    return base;
  }
}
