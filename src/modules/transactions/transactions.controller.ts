// src/modules/transactions/transactions.controller.ts

import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiBearerAuth,
  ApiSecurity,
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
  Version,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { InitiatePaymentRequestDto } from './dto/initiate-payment.dto';
import { CapturePaymentRequestDto } from './dto/capture-payment.dto';
import { RefundPaymentRequestDto } from './dto/refund-payment.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';

@Controller({ path: 'payments', version: '1' })
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  // POST /api/v1/payments
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Initiate a new payment' })
  @ApiHeader({
    name: 'x-merchant-id',
    required: true,
    description: 'Merchant UUID',
  })
  @ApiHeader({
    name: 'idempotency-key',
    required: true,
    description: 'UUID v4 idempotency key',
  })
  @ApiResponse({ status: 201, description: 'Payment initiated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({
    status: 409,
    description: 'Idempotency conflict — request in progress',
  })
  @ApiResponse({ status: 503, description: 'No gateway available' })
  async initiatePayment(
    @Body() body: InitiatePaymentRequestDto,
    @Headers('x-merchant-id') merchantId: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() req: any,
    @Headers('x-mock-response') mockResponse?: string,
    @Headers('x-mock-delay-ms') mockDelayMs?: string,
    @Headers('x-mock-gateway-down') mockGatewayDown?: string,
  ): Promise<PaymentResponseDto> {
    // Read traceId from request object set by TraceIdInterceptor
    // Falls back to header if interceptor hasn't run (shouldn't happen)
    const traceId = req.traceId ?? req.headers?.['x-trace-id'] ?? 'unknown';

    console.log('merchantId from header:', merchantId);

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
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async getPayment(@Param('id', ParseUUIDPipe) id: string): Promise<PaymentResponseDto> {
    const transaction = await this.transactionsService.findById(id);
    return PaymentResponseDto.fromEntity(transaction);
  }

  // GET /api/v1/payments?merchant_order_id=xxx
  @Get()
  async getByMerchantOrderId(
    @Query('merchant_order_id') merchantOrderId: string,
    @Headers('x-merchant-id') merchantId: string,
  ): Promise<PaymentResponseDto> {
    const transaction = await this.transactionsService.findByMerchantOrderId(
      merchantId,
      merchantOrderId,
    );
    return PaymentResponseDto.fromEntity(transaction);
  }

  // POST /api/v1/payments/:id/capture
  @Post(':id/capture')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Capture an authorised payment' })
  @ApiResponse({ status: 200, description: 'Payment captured' })
  @ApiResponse({ status: 422, description: 'Invalid state transition' })
  async capturePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CapturePaymentRequestDto,
    @Headers('x-merchant-id') merchantId: string,
    @Req() req: any,
  ): Promise<PaymentResponseDto> {
    const traceId = req.traceId ?? 'unknown';
    const transaction = await this.transactionsService.capturePayment({
      transactionId: id,
      amountPaise: body.amountPaise,
      traceId,
      triggeredBy: `merchant:${merchantId}`,
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
    @Headers('x-merchant-id') merchantId: string,
    @Req() req: any,
  ): Promise<PaymentResponseDto> {
    const traceId = req.traceId ?? 'unknown';
    const transaction = await this.transactionsService.voidPayment({
      transactionId: id,
      traceId,
      triggeredBy: `merchant:${merchantId}`,
    });
    return PaymentResponseDto.fromEntity(transaction);
  }

  // POST /api/v1/payments/:id/refund
  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refund a completed payment' })
  @ApiResponse({ status: 200, description: 'Payment refunded' })
  @ApiResponse({ status: 422, description: 'Invalid state transition' })
  async refundPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RefundPaymentRequestDto,
    @Headers('x-merchant-id') merchantId: string,
    @Req() req: any,
  ): Promise<PaymentResponseDto> {
    const traceId = req.traceId ?? 'unknown';
    const transaction = await this.transactionsService.refundPayment({
      transactionId: id,
      amountPaise: body.amountPaise,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
      traceId,
      triggeredBy: `merchant:${merchantId}`,
    });
    return PaymentResponseDto.fromEntity(transaction);
  }

  // GET /api/v1/payments/:id/timeline
  @Get(':id/timeline')
  @ApiOperation({ summary: 'Retrieve payment timeline' })
  @ApiResponse({ status: 200, description: 'Timeline retrieved' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async getTimeline(@Param('id', ParseUUIDPipe) id: string) {
    return this.transactionsService.getTimeline(id);
  }

  // GET /api/v1/payments/:id/refunds
  @Get(':id/refunds')
  @ApiOperation({ summary: 'Retrieve payment refunds' })
  @ApiResponse({ status: 200, description: 'Refunds retrieved' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async getRefunds(@Param('id', ParseUUIDPipe) id: string) {
    // Placeholder — returns empty array until refund repo is queried
    return [];
  }

  // GET /api/v1/analytics/success-rate
  @Get('analytics/success-rate')
  async getSuccessRate(@Query() query: AnalyticsQueryDto) {
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 86_400_000);
    const to = query.to ? new Date(query.to) : new Date();
    return this.transactionsService.getSuccessRateAnalytics(from, to);
  }

  // GET /api/v1/analytics/volume
  @Get('analytics/volume')
  async getVolume(@Query() query: AnalyticsQueryDto) {
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 86_400_000);
    const to = query.to ? new Date(query.to) : new Date();
    return this.transactionsService.getVolumeAnalytics(from, to);
  }
}
