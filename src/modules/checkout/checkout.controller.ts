// src/modules/checkout/checkout.controller.ts

import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
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

// Interswitch documents the field as `txnref`, but casing/underscore variants
// (txnRef, txn_ref, TXNREF ...) are matched too, in the form body or the query.
function findTxnRef(...sources: Array<Record<string, unknown> | undefined>): string | undefined {
  for (const source of sources) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (
        /^(txn|transaction)_?ref(erence)?$/i.test(key) &&
        typeof value === 'string' &&
        value.trim()
      ) {
        return value.trim();
      }
    }
  }
  return undefined;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

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
  verifyRetryDelayMs = 2000;
  // Background verifications still running; lets tests (and shutdown) await them.
  private readonly background = new Set<Promise<void>>();

  constructor(
    private readonly transactionRepo: TransactionRepository,
    private readonly gatewayConfigRepo: GatewayConfigRepository,
    private readonly interswitch: InterswitchAdapter,
    private readonly processor: WebhookProcessorService,
  ) {}

  async settled(): Promise<void> {
    await Promise.all([...this.background]);
  }

  // Runs verification without holding the payer's request open: Interswitch's
  // status API can hang for the full gateway timeout (45s+).
  private verifyInBackground(txnRef: string): void {
    const job = this.verifyAndAdvance(txnRef, { attempts: 3 }).finally(() =>
      this.background.delete(job),
    );
    this.background.add(job);
  }

  // `budgetMs` bounds each status call when a human is waiting on the response
  // (the checkout page); the background job uses the adapter's own timeout.
  private async verifyAndAdvance(
    txnRef: string,
    opts: { attempts: number; budgetMs?: number },
  ): Promise<void> {
    const check = (id: string, traceId: string, amount: bigint) => {
      const call = this.interswitch.fetchStatus(id, traceId, amount);
      return opts.budgetMs ? withTimeout(call, opts.budgetMs) : call;
    };
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

      // The status API can lag the redirect by a moment, so a "not found /
      // in progress" answer is retried a couple of times before giving up.
      let status = await check(txn.id, txn.traceId, expected);
      for (let attempt = 1; attempt < opts.attempts && status.status === 'authorised'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, this.verifyRetryDelayMs));
        status = await check(txn.id, txn.traceId, expected);
      }

      this.logger.log('Interswitch status check', {
        transactionId: txn.id,
        gatewayStatus: status.status,
        responseCode: status.rawResponse?.['ResponseCode'],
        responseDescription: status.rawResponse?.['ResponseDescription'],
        amountReturned: status.amountPaise?.toString(),
        amountExpected: expected.toString(),
      });

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
    // A payer who already paid (return never reached us) reopening this link
    // should be recognised, not shown the payment form again.
    if (txn.state === TransactionState.AUTH_INITIATED) {
      await this.verifyAndAdvance(id, { attempts: 1, budgetMs: 6000 });
      const refreshed = await this.transactionRepo.findById(id);
      if (refreshed?.state === TransactionState.CAPTURED) {
        const cfg = await this.gatewayConfigRepo.findByGateway(PaymentGateway.INTERSWITCH);
        const url = cfg?.metadata?.['returnUrl'];
        if (typeof url === 'string' && url) {
          reply.status(303).header('Location', url.replaceAll('{transactionId}', id)).send();
          return;
        }
      }
      txn.state = refreshed?.state ?? txn.state;
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

  // Preferred: our transaction ID is part of the URL we gave Interswitch as
  // site_redirect_url, so we never depend on what the hosted page echoes back
  // (in practice its `txnref` field arrived blank). Verification asks
  // Interswitch about THIS transaction, so the path value is only a lookup key.
  @Post('return/:id')
  async returnForTransaction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, string> | undefined,
    @Res() reply: FastifyReply,
    @Headers('content-type') contentType?: string,
  ): Promise<void> {
    await this.handleReturn(id, body, {}, contentType, reply);
  }

  // Legacy route (payments created before the path form existed).
  @Post('return')
  async returnFromInterswitch(
    @Body() body: Record<string, string> | undefined,
    @Res() reply: FastifyReply,
    @Query() query: Record<string, string> = {},
    @Headers('content-type') contentType?: string,
  ): Promise<void> {
    await this.handleReturn(findTxnRef(body, query), body, query, contentType, reply);
  }

  private async handleReturn(
    txnRef: string | undefined,
    body: Record<string, string> | undefined,
    query: Record<string, string>,
    contentType: string | undefined,
    reply: FastifyReply,
  ): Promise<void> {
    // Only non-sensitive fields are logged by value (never cardNum/mac).
    const safe = ['txnref', 'resp', 'desc', 'amount', 'apprAmt'];
    this.logger.log('Interswitch return received', {
      contentType,
      bodyKeys: Object.keys(body ?? {}),
      queryKeys: Object.keys(query),
      fields: Object.fromEntries(safe.map((k) => [k, body?.[k]])),
      txnRefFound: Boolean(txnRef),
      txnRefIsUuid: Boolean(txnRef && UUID_RE.test(txnRef)),
    });

    const config = await this.gatewayConfigRepo.findByGateway(PaymentGateway.INTERSWITCH);
    const returnUrl = config?.metadata?.['returnUrl'];
    const validRef = Boolean(txnRef && UUID_RE.test(txnRef));

    // Answer the payer first; confirm the payment with Interswitch afterwards.
    if (validRef && typeof returnUrl === 'string' && returnUrl) {
      reply
        .status(303)
        .header('Location', returnUrl.replaceAll('{transactionId}', txnRef as string))
        .send();
      this.verifyInBackground(txnRef as string);
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
    if (validRef) this.verifyInBackground(txnRef as string);
  }
}
