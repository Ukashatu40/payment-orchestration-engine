// src/modules/checkout/checkout.controller.ts

import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Logger } from '@nestjs/common';
import { TransactionRepository } from '../transactions/repositories/transaction.repository';
import { GatewayConfigRepository } from '../gateways/repositories/gateway-config.repository';
import { InterswitchAdapter } from '../gateways/adapters/interswitch.adapter';
import { WebhookProcessorService } from '../webhooks/webhook-processor.service';
import { PaymentGateway, TransactionState } from '../../common/enums';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">${body}</body></html>`;
}

// Interswitch Web Checkout is browser-driven: the payer's browser must POST
// a form to Interswitch and is POSTed back afterwards. These two routes are
// that browser-facing leg (public — no credentials can ride a redirect).
// On return, the payment is verified server-side with Interswitch
// (gettransaction.json) and only an APPROVED, amount-matching result advances
// the transaction — the browser-supplied form fields are never trusted, and
// completion does not depend on a webhook being configured. Anything else
// (pending, declined, lookup errors) is left for the TRANSACTION.COMPLETED
// webhook / reconciliation job.
@ApiExcludeController()
@Controller({ path: 'checkout/interswitch', version: '1' })
export class CheckoutController {
  private readonly logger = new Logger(CheckoutController.name);

  constructor(
    private readonly transactionRepo: TransactionRepository,
    private readonly gatewayConfigRepo: GatewayConfigRepository,
    private readonly interswitch: InterswitchAdapter,
    private readonly processor: WebhookProcessorService,
  ) {}

  private async verifyAndAdvance(txnRef: string): Promise<void> {
    try {
      const txn = await this.transactionRepo.findById(txnRef);
      if (
        !txn ||
        txn.gateway !== PaymentGateway.INTERSWITCH ||
        txn.state !== TransactionState.AUTH_INITIATED
      ) {
        return;
      }

      const expected = BigInt(txn.amountPaise);
      const status = await this.interswitch.fetchStatus(txn.id, txn.traceId, expected);
      if (status.status !== 'captured') return;

      if (status.amountPaise !== expected) {
        this.logger.warn('Interswitch approved an amount that differs from the transaction', {
          transactionId: txn.id,
          expected: expected.toString(),
          received: status.amountPaise.toString(),
        });
        return;
      }

      await this.processor.advanceTransaction(txn, TransactionState.CAPTURED, {
        event: 'INTERSWITCH_RETURN_VERIFIED',
        triggeredBy: 'checkout_return',
        gatewayReference: txn.id,
        gatewayResponse: status.rawResponse,
        metadata: { source: 'browser_return' },
      });
    } catch (err) {
      // Never break the payer's redirect; the webhook/reconciliation still apply.
      this.logger.error('Interswitch return verification failed', {
        txnRef,
        error: (err as Error).message,
      });
    }
  }

  @Get(':id')
  async checkoutPage(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('email') email: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'no-store');

    const txn = await this.transactionRepo.findById(id);
    if (!txn || txn.gateway !== PaymentGateway.INTERSWITCH) {
      reply.status(404).send(page('Not found', '<h1>Payment not found</h1>'));
      return;
    }
    if (txn.state !== TransactionState.AUTH_INITIATED) {
      reply
        .status(409)
        .send(page('Payment unavailable', '<h1>This payment can no longer be paid</h1>'));
      return;
    }

    const config = await this.gatewayConfigRepo.findByGateway(PaymentGateway.INTERSWITCH);
    if (!config) {
      reply.status(503).send(page('Unavailable', '<h1>Payment gateway unavailable</h1>'));
      return;
    }

    const form = this.interswitch.buildCheckoutForm(config, {
      transactionId: txn.id,
      amountPaise: BigInt(txn.amountPaise),
      currency: txn.currency,
      email: email && EMAIL_RE.test(email) ? email : undefined,
    });

    const inputs = Object.entries(form.fields)
      .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
      .join('');

    reply.send(
      page(
        'Redirecting to Interswitch',
        `<h1>Redirecting to Interswitch…</h1><form id="pay" method="POST" action="${escapeHtml(form.action)}">${inputs}<noscript><button type="submit">Continue to payment</button></noscript></form><script>document.getElementById('pay').submit()</script>`,
      ),
    );
  }

  @Post('return')
  async returnFromInterswitch(
    @Body() body: Record<string, string> | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const txnRef = body?.['txnref'] ?? body?.['txnRef'];
    if (txnRef && UUID_RE.test(txnRef)) {
      await this.verifyAndAdvance(txnRef);
    }
    const config = await this.gatewayConfigRepo.findByGateway(PaymentGateway.INTERSWITCH);
    const returnUrl = config?.metadata?.['returnUrl'];

    if (txnRef && UUID_RE.test(txnRef) && typeof returnUrl === 'string' && returnUrl) {
      reply.status(303).header('Location', returnUrl.replaceAll('{transactionId}', txnRef)).send();
      return;
    }

    reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(
        page(
          'Payment submitted',
          '<h1>Thanks — your payment is being confirmed.</h1><p>You can close this page.</p>',
        ),
      );
  }
}
