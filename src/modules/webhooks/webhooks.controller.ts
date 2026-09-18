// src/modules/webhooks/webhooks.controller.ts

import {
  Controller,
  Post,
  Get,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
  Req,
  Query,
  Version,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { type FastifyRequest } from 'fastify';
import { WebhookSignatureService } from './verification/webhook-signature.service';
import { WebhookQueueService } from './webhook-queue.service';
import { WebhookProcessorService } from './webhook-processor.service';
import { GatewayConfigRepository } from '../gateways/repositories/gateway-config.repository';
import { PaymentGateway, UserRole } from '../../common/enums';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { type AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { UserAuditLogRepository } from '../users/repositories/user-audit-log.repository';
import { WebhookQueueEntryDto } from './dto/webhook-queue-entry.dto';
import { ReplayWebhookResultDto } from './dto/replay-webhook-result.dto';

@ApiTags('webhooks')
@ApiSecurity('X-API-Key')
@Controller({ path: 'webhooks', version: '1' })
export class WebhooksController {
  constructor(
    private readonly signatureService: WebhookSignatureService,
    private readonly queueService: WebhookQueueService,
    private readonly processorService: WebhookProcessorService,
    private readonly gatewayConfigRepo: GatewayConfigRepository,
    private readonly auditLogRepo: UserAuditLogRepository,
  ) {}

  // POST /api/v1/webhooks/razorpay
  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Razorpay webhook' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  async razorpayWebhook(@Req() req: FastifyRequest): Promise<{ received: true }> {
    return this.handleWebhook(PaymentGateway.RAZORPAY, req);
  }

  // POST /api/v1/webhooks/stripe
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Stripe webhook' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  async stripeWebhook(@Req() req: FastifyRequest): Promise<{ received: true }> {
    return this.handleWebhook(PaymentGateway.STRIPE, req);
  }

  // POST /api/v1/webhooks/payu
  @Post('payu')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle PayU webhook' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  async payuWebhook(@Req() req: FastifyRequest): Promise<{ received: true }> {
    return this.handleWebhook(PaymentGateway.PAYU, req);
  }

  // POST /api/v1/webhooks/upi
  @Post('upi')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle UPI webhook' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  async upiWebhook(@Req() req: FastifyRequest): Promise<{ received: true }> {
    return this.handleWebhook(PaymentGateway.UPI, req);
  }

  // POST /api/v1/webhooks/paystack
  @Post('paystack')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Paystack webhook' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  async paystackWebhook(@Req() req: FastifyRequest): Promise<{ received: true }> {
    return this.handleWebhook(PaymentGateway.PAYSTACK, req);
  }

  // POST /api/v1/webhooks/flutterwave
  @Post('flutterwave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Flutterwave webhook' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  async flutterwaveWebhook(@Req() req: FastifyRequest): Promise<{ received: true }> {
    return this.handleWebhook(PaymentGateway.FLUTTERWAVE, req);
  }

  // POST /api/v1/webhooks/interswitch
  @Post('interswitch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Interswitch webhook' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  async interswitchWebhook(@Req() req: FastifyRequest): Promise<{ received: true }> {
    return this.handleWebhook(PaymentGateway.INTERSWITCH, req);
  }

  // POST /api/v1/webhooks/opay
  @Post('opay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Opay webhook' })
  @ApiResponse({ status: 200, description: 'Webhook received' })
  async opayWebhook(@Req() req: FastifyRequest): Promise<{ received: true }> {
    return this.handleWebhook(PaymentGateway.OPAY, req);
  }

  // GET /api/v1/webhooks/dlq
  @Get('dlq')
  @ApiOperation({ summary: 'Retrieve failed webhooks' })
  @ApiQuery({ name: 'gateway', required: false, enum: PaymentGateway })
  @ApiResponse({
    status: 200,
    description: 'Failed webhooks retrieved',
    type: [WebhookQueueEntryDto],
  })
  async getDLQ(@Query('gateway') gateway?: PaymentGateway): Promise<WebhookQueueEntryDto[]> {
    return this.queueService.getDLQ(gateway);
  }

  // POST /api/v1/webhooks/dlq/:id/replay
  // Dangerous: re-triggers processing of a previously-failed webhook
  // event. Requires a real user session with an admin role.
  @Post('dlq/:id/replay')
  @Roles(UserRole.SUPER_ADMIN, UserRole.OPS_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replay a failed webhook' })
  @ApiResponse({
    status: 200,
    description: 'Webhook replayed',
    type: ReplayWebhookResultDto,
  })
  @ApiResponse({ status: 403, description: 'Requires SUPER_ADMIN or OPS_ADMIN' })
  async replayDLQ(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReplayWebhookResultDto> {
    await this.queueService.replayFromDLQ(id);

    await this.auditLogRepo.record({
      actorUserId: user.id,
      action: 'WEBHOOK_REPLAYED',
      targetType: 'webhook_queue',
      targetId: id,
    });

    return { replayed: true };
  }

  // ----------------------------------------------------------------
  // Shared webhook handler — all four gateways flow through here.
  //
  // Immediately returns HTTP 200 after:
  // 1. Signature verification
  // 2. Enqueue to webhook_queue
  //
  // Processing happens asynchronously — decouples ingestion from
  // processing latency (Section A5.2).
  // Webhook P95 target: < 200ms (Section B3).
  // ----------------------------------------------------------------
  private async handleWebhook(
    gateway: PaymentGateway,
    req: FastifyRequest,
  ): Promise<{ received: true }> {
    // rawBody attached by Fastify content type parser (main.ts)
    const rawBody = (req as any).rawBody as Buffer;
    const payload = req.body as Record<string, unknown>;
    const headers = req.headers as Record<string, string>;

    // Step 1: Load webhook secret for this gateway
    const config = await this.gatewayConfigRepo.findByGateway(gateway);
    const secret = config?.webhookSecret ?? 'mock-webhook-secret';

    // Step 2: Verify signature — throws 401 on failure (FS-10)
    // Uses rawBody buffer, not re-serialised JSON (Deliberate Error 5 fix)
    this.signatureService.verify(gateway, rawBody, headers, secret);

    // Step 3: Extract event metadata
    const eventId = this.queueService.extractEventId(gateway, payload);
    const eventType = this.queueService.extractEventType(gateway, payload);

    // Step 4: Get signature for storage. Opay carries its signature as
    // a body field (`sha512`), not a header, unlike every other
    // gateway here — see webhook-signature.service.ts.
    const signatureHeader =
      headers['x-razorpay-signature'] ??
      headers['stripe-signature'] ??
      headers['x-payu-signature'] ??
      headers['x-upi-signature'] ??
      headers['x-paystack-signature'] ??
      headers['verif-hash'] ??
      headers['x-interswitch-signature'] ??
      (payload['sha512'] as string | undefined) ??
      '';

    // Step 5: Enqueue for async processing
    await this.queueService.enqueue({
      gateway,
      eventId,
      eventType,
      payload,
      rawBody,
      signature: signatureHeader,
    });

    // Return immediately — processing is async
    return { received: true };
  }
}
