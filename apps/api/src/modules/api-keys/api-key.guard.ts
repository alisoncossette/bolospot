import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Extract API key from headers
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException('API key required');
    }

    // Validate the API key
    const result = await this.apiKeysService.validateApiKey(apiKey);

    if (!result) {
      throw new UnauthorizedException('Invalid or expired API key');
    }

    // Attach user and API key info to request
    request.apiKeyUser = result.user;
    request.apiKey = result.apiKey;

    return true;
  }

  private extractApiKey(request: any): string | null {
    // Check x-api-key header first
    const xApiKey = request.headers['x-api-key'];
    if (xApiKey) {
      return xApiKey;
    }

    // Check Authorization header with Bearer prefix
    const authHeader = request.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer bolo_')) {
      return authHeader.substring(7); // Remove "Bearer "
    }

    // Never accept API keys from query params — they leak into logs, referrers, and browser history

    return null;
  }
}