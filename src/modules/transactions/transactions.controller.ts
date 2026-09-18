// src/modules/transactions/transactions.controller.ts

import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiBearerAuth,
  ApiSecurity,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { InitiatePaymentRequestDto } from './dto/initiate-payment.dto';
import { CapturePaymentRequestDto } from './dto/capture-payment.dto';
import { RefundPaymentRequestDto } from './dto/refund-payment.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { type ListPaymentsResponseDto } from './dto/list-payments-response.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { RefundResponseDto } from './dto/refund-response.dto';
import { CurrentMerchant } from '../auth/decorators/current-merchant.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { type RequestPrincipal } from '../auth/interfaces/jwt-payload.interface';
import { UserRole, TransactionState, PaymentGateway } from '../../common/enums';
import { Transaction } from './entities/transaction.entity';

@Controller({ path: 'payments', version: '1' })
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  // POST /api/v1/payments
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Initiate a new payment' })
  @ApiHeader({
    name: 'x-merchant-id',
    required: false,
    description:
      'Merchant UUID — only honored for legacy API-key callers. Ignored for ' +
      'user-session (JWT) callers, whose merchant is derived from their session.',
  })
  @ApiHeader({
    name: 'idempotency-key',
    required: true,
    description: 'UUID v4 idempotency key',
  })
  @ApiResponse({ status: 201, description: 'Payment initiated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Invalid or missing credentials' })
  @ApiResponse({
    status: 409,
    description: 'Idempotency conflict — request in progress',
  })
  @ApiResponse({ status: 503, description: 'No gateway available' })
  async initiatePayment(
    @Body() body: InitiatePaymentRequestDto,
    @CurrentMerchant() merchantId: string,
    @Req() req: any,
    @Headers('idempotency-key') idempotencyKey: string,
    @Headers('x-mock-response') mockResponse?: string,
    @Headers('x-mock-delay-ms') mockDelayMs?: string,
    @Headers('x-mock-gateway-down') mockGatewayDown?: string,
  ): Promise<PaymentResponseDto> {
    // Read traceId from request object set by TraceIdInterceptor
    // Falls back to header if interceptor hasn't run (shouldn't happen)
    const traceId = req.traceId ?? req.headers?.['x-trace-id'] ?? 'unknown';

    const transaction = await this.transactionsService.initiatePayment({
      merchantId,
      merchantOrderId: body.merchantOrderId,
      amountPaise: body.amountPaise,
      currency: body.currency,
      paymentMethod: body.paymentMethod,
      idempotencyKey,
      traceId,
      metadata: {
        ...body.metadata,
        ...(mockResponse && { 'x-mock-response': mockResponse }),
        ...(mockDelayMs && { 'x-mock-delay-ms': parseInt(mockDelayMs) }),
        ...(mockGatewayDown && {
          'x-mock-gateway-down': mockGatewayDown === 'true',
        }),
      },
    });

    return PaymentResponseDto.fromEntity(transaction);
  }

  // GET /api/v1/payments/:id
  @Get(':id')
  @ApiOperation({ summary: 'Retrieve payment details by ID' })
  @ApiResponse({ status: 200, description: 'Payment found' })
  @ApiResponse({ status: 403, description: 'Transaction belongs to a different merchant' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async getPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: RequestPrincipal,
  ): Promise<PaymentResponseDto> {
    const transaction = await this.transactionsService.findById(id);
    this.assertOwnership(transaction, principal);
    return PaymentResponseDto.fromEntity(transaction);
  }

  // GET /api/v1/payments?merchant_order_id=xxx  — exact single lookup
  // GET /api/v1/payments?state=&gateway=&from=&to=&page=&pageSize=
  //   — paginated/filterable list (A.6.1 — this codebase previously
  //   had no list-all endpoint, only single lookups). For merchant-role
  //   JWTs the merchant filter is forced server-side; for internal
  //   roles/legacy API keys it's optional (omitting it lists across
  //   all merchants), matching the same scoping already used by the
  //   analytics endpoints below.
  @Get()
  @ApiOperation({ summary: 'Look up a payment by merchant_order_id, or list/filter payments' })
  @ApiQuery({ name: 'merchant_order_id', required: false })
  @ApiQuery({ name: 'state', required: false, enum: TransactionState })
  @ApiQuery({ name: 'gateway', required: false, enum: PaymentGateway })
  @ApiQuery({ name: 'from', required: false, description: 'ISO 8601 date' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO 8601 date' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async listOrGetPayments(
    @Query('merchant_order_id') merchantOrderId: string | undefined,
    @Query() query: ListPaymentsQueryDto,
    @CurrentMerchant({ required: false }) merchantId: string | undefined,
  ): Promise<PaymentResponseDto | ListPaymentsResponseDto> {
    if (merchantOrderId) {
      if (!merchantId) {
        throw new BadRequestException('merchant_order_id lookup requires a resolvable merchant');
      }
      const transaction = await this.transactionsService.findByMerchantOrderId(
        merchantId,
        merchantOrderId,
      );
      return PaymentResponseDto.fromEntity(transaction);
    }

    return this.transactionsService.listPayments({
      merchantId,
      state: query.state,
      gateway: query.gateway,
      fromDate: query.from ? new Date(query.from) : undefined,
      toDate: query.to ? new Date(query.to) : undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  // POST /api/v1/payments/:id/capture
  @Post(':id/capture')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Capture an authorised payment' })
  @ApiResponse({ status: 200, description: 'Payment captured' })
  @ApiResponse({ status: 422, description: 'Invalid state transition' })
  @ApiBody({
    description: 'Optional amount to capture (for partial captures)',
    schema: {
      type: 'object',
      properties: {
        amountPaise: { type: 'integer', minimum: 1 },
      },
      example: {
        amountPaise: 5000,
      },
    },
  })
  async capturePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CapturePaymentRequestDto,
    @CurrentPrincipal() principal: RequestPrincipal,
    @Req() req: any,
  ): Promise<PaymentResponseDto> {
    await this.assertOwnershipById(id, principal);
    const traceId = req.traceId ?? 'unknown';
    const transaction = await this.transactionsService.capturePayment({
      transactionId: id,
      amountPaise: body.amountPaise,
      traceId,
      triggeredBy: this.describeTrigger(principal),
    });
    return PaymentResponseDto.fromEntity(transaction);
  }

  // POST /api/v1/payments/:id/void
  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void an authorised payment' })
  @ApiResponse({ status: 200, description: 'Payment voided' })
  @ApiResponse({ status: 422, description: 'Invalid state transition' })
  async voidPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: RequestPrincipal,
    @Req() req: any,
  ): Promise<PaymentResponseDto> {
    await this.assertOwnershipById(id, principal);
    const traceId = req.traceId ?? 'unknown';
    const transaction = await this.transactionsService.voidPayment({
      transactionId: id,
      traceId,
      triggeredBy: this.describeTrigger(principal),
    });
    return PaymentResponseDto.fromEntity(transaction);
  }

  // POST /api/v1/payments/:id/refund
  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refund a completed payment' })
  @ApiResponse({ status: 200, description: 'Payment refunded' })
  @ApiResponse({ status: 422, description: 'Invalid state transition' })
  @ApiBody({
    description: 'Refund amount and reason',
    schema: {
      type: 'object',
      properties: {
        amountPaise: { type: 'integer', minimum: 1 },
        reason: { type: 'string' },
        idempotencyKey: { type: 'string', format: 'uuid' },
      },
      required: ['amountPaise', 'idempotencyKey'],
      example: {
        amountPaise: 5000,
        reason: 'Customer requested refund',
        idempotencyKey: '123e4567-e89b-12d3-a456-426614174000',
      },
    },
  })
  async refundPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RefundPaymentRequestDto,
    @CurrentPrincipal() principal: RequestPrincipal,
    @Req() req: any,
  ): Promise<PaymentResponseDto> {
    await this.assertOwnershipById(id, principal);
    const traceId = req.traceId ?? 'unknown';
    const transaction = await this.transactionsService.refundPayment({
      transactionId: id,
      amountPaise: body.amountPaise,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
      traceId,
      triggeredBy: this.describeTrigger(principal),
    });
    return PaymentResponseDto.fromEntity(transaction);
  }

  // GET /api/v1/payments/:id/timeline
  @Get(':id/timeline')
  @ApiOperation({ summary: 'Retrieve payment timeline' })
  @ApiResponse({ status: 200, description: 'Timeline retrieved' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async getTimeline(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: RequestPrincipal,
  ) {
    await this.assertOwnershipById(id, principal);
    return this.transactionsService.getTimeline(id);
  }

  // GET /api/v1/payments/:id/refunds
  @Get(':id/refunds')
  @ApiOperation({ summary: 'List refunds for a payment' })
  @ApiResponse({ status: 200, description: 'Refunds retrieved' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async getRefunds(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPrincipal() principal: RequestPrincipal,
  ): Promise<RefundResponseDto[]> {
    await this.assertOwnershipById(id, principal);
    const refunds = await this.transactionsService.getRefunds(id);
    return refunds.map(RefundResponseDto.fromEntity);
  }

  // GET /api/v1/analytics/success-rate
  @Get('analytics/success-rate')
  @ApiOperation({ summary: 'Get payment success rate analytics' })
  @ApiResponse({ status: 200, description: 'Success rate analytics retrieved' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Start date for analytics (ISO 8601 format)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'End date for analytics (ISO 8601 format)',
  })
  async getSuccessRate(
    @Query() query: AnalyticsQueryDto,
    @CurrentMerchant({ required: false }) merchantId: string | undefined,
  ) {
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 86_400_000);
    const to = query.to ? new Date(query.to) : new Date();
    return this.transactionsService.getSuccessRateAnalytics(from, to, merchantId);
  }

  // GET /api/v1/analytics/volume
  @Get('analytics/volume')
  @ApiOperation({ summary: 'Get payment volume analytics' })
  @ApiResponse({ status: 200, description: 'Volume analytics retrieved' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Start date for analytics (ISO 8601 format)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'End date for analytics (ISO 8601 format)',
  })
  async getVolume(
    @Query() query: AnalyticsQueryDto,
    @CurrentMerchant({ required: false }) merchantId: string | undefined,
  ) {
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 86_400_000);
    const to = query.to ? new Date(query.to) : new Date();
    return this.transactionsService.getVolumeAnalytics(from, to, merchantId);
  }

  // ----------------------------------------------------------------
  // Merchant-ownership enforcement (the A.4 fix). Internal roles
  // (OPS_*/SUPER_ADMIN) and legacy API-key callers are unrestricted —
  // matches pre-existing behavior for those paths. MERCHANT_* JWTs may
  // only touch their own merchant's transactions.
  // ----------------------------------------------------------------
  private assertOwnership(transaction: Transaction, principal: RequestPrincipal): void {
    if (principal.type !== 'user') return;
    if (principal.role !== UserRole.MERCHANT_ADMIN && principal.role !== UserRole.MERCHANT_VIEWER)
      return;

    if (transaction.merchantId !== principal.merchantId) {
      throw new ForbiddenException('This transaction does not belong to your merchant account');
    }
  }

  private async assertOwnershipById(
    transactionId: string,
    principal: RequestPrincipal,
  ): Promise<void> {
    if (principal.type !== 'user') return;
    if (principal.role !== UserRole.MERCHANT_ADMIN && principal.role !== UserRole.MERCHANT_VIEWER)
      return;

    const transaction = await this.transactionsService.findById(transactionId);
    this.assertOwnership(transaction, principal);
  }

  private describeTrigger(principal: RequestPrincipal): string {
    return principal.type === 'user' ? `user:${principal.id}` : 'api_key';
  }
}
