import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  Req,
  Headers,
  HttpCode,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { BillingService } from './billing.service';
import { UsageService } from './usage.service';
import { CreateCheckoutDto } from './dto/billing.dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(
    private billingService: BillingService,
    private usageService: UsageService,
  ) {}

  @Get('plan')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current plan and usage' })
  @ApiResponse({ status: 200, description: 'Plan details and usage returned' })
  async getPlan(@Request() req: any) {
    const [plan, usage] = await Promise.all([
      this.billingService.getPlanDetails(req.user.id),
      this.usageService.getUsage(req.user.id),
    ]);
    return { ...plan, usage };
  }

  @Post('checkout')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Stripe checkout session for plan upgrade' })
  @ApiResponse({ status: 200, description: 'Checkout URL returned' })
  async createCheckout(
    @Request() req: any,
    @Body() body: CreateCheckoutDto,
  ) {
    return this.billingService.createCheckoutSession(req.user.id, body.plan);
  }

  @Post('portal')
  @UseGuards(SessionAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create Stripe billing portal session' })
  @ApiResponse({ status: 200, description: 'Portal URL returned' })
  async createPortal(@Request() req: any) {
    return this.billingService.createPortalSession(req.user.id);
  }

  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Stripe webhook handler' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    await this.billingService.handleWebhook(req.rawBody!, signature);
    return { received: true };
  }
}
