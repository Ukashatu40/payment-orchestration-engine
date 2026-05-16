// src/modules/transactions/transactions.controller.ts

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Headers,
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

@Controller('payments')
@Version('1')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  // POST /api/v1/payments
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async initiatePayment(
    @Body() body: InitiatePaymentRequestDto,
    @Headers('x-merchant-id') merchantId: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Headers('x-trace-id') traceId: string,
  ): Promise<PaymentResponseDto> {
    const transaction = await this.transactionsService.initiatePayment({
      merchantId,
      merchantOrderId: body.merchantOrderId,
      amountPaise: body.amountPaise,
      currency: body.currency,
      paymentMethod: body.paymentMethod,
      idempotencyKey,
      traceId,
      metadata: body.metadata,
    });

    return PaymentResponseDto.fromEntity(transaction);
  }

  // GET /api/v1/payments/:id
  @Get(':id')
  async getPayment(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentResponseDto> {
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
  async capturePayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CapturePaymentRequestDto,
    @Headers('x-merchant-id') merchantId: string,
    @Headers('x-trace-id') traceId: string,
  ): Promise<PaymentResponseDto> {
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
  async voidPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-merchant-id') merchantId: string,
    @Headers('x-trace-id') traceId: string,
  ): Promise<PaymentResponseDto> {
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
  async refundPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RefundPaymentRequestDto,
    @Headers('x-merchant-id') merchantId: string,
    @Headers('x-trace-id') traceId: string,
  ): Promise<PaymentResponseDto> {
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
  async getTimeline(@Param('id', ParseUUIDPipe) id: string) {
    return this.transactionsService.getTimeline(id);
  }

  // GET /api/v1/payments/:id/refunds
  @Get(':id/refunds')
  async getRefunds(@Param('id', ParseUUIDPipe) id: string) {
    // Placeholder — returns empty array until refund repo is queried
    return [];
  }

  // GET /api/v1/analytics/success-rate
  @Get('analytics/success-rate')
  async getSuccessRate(@Query() query: AnalyticsQueryDto) {
    const from = query.from
      ? new Date(query.from)
      : new Date(Date.now() - 86_400_000);
    const to = query.to ? new Date(query.to) : new Date();
    return this.transactionsService.getSuccessRateAnalytics(from, to);
  }

  // GET /api/v1/analytics/volume
  @Get('analytics/volume')
  async getVolume(@Query() query: AnalyticsQueryDto) {
    const from = query.from
      ? new Date(query.from)
      : new Date(Date.now() - 86_400_000);
    const to = query.to ? new Date(query.to) : new Date();
    return this.transactionsService.getVolumeAnalytics(from, to);
  }
}
