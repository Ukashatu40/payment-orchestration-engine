# Deployment (free tier): Neon + Render + Vercel

| Piece | Host | Why |
|---|---|---|
| Postgres | Neon (free, permanent, 0.5 GB) | Render free Postgres expires after 30 days; Docker Postgres on Render free has no persistent disk |
| Backend | Render web service (Docker) | `render.yaml` in the repo root |
| Ops + merchant apps | Vercel (two projects) | Next.js, root dir per app |

## 1. Database (Neon)
1. Create a project, copy the **direct** (non-pooled) connection string.
2. Nothing to run by hand: migrations run automatically on backend boot.

## 2. Backend (Render)
1. New > Blueprint > pick the backend repo (`render.yaml`).
2. Fill the prompted env vars:
   - `DATABASE_URL` — Neon string (`...?sslmode=require`)
   - `API_KEYS` — comma-separated random keys (server-to-server callers)
   - `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` — required in production; the first migration refuses to run without a password, so no public default credential exists
   - `CORS_ORIGIN` — the two Vercel URLs (browsers only talk to Vercel; this is defence in depth)
   - `JWT_SECRET` is generated for you (boot fails if it is missing/short in production)
3. Verify: `GET https://<service>.onrender.com/api/v1/health` returns 200.
4. Free-tier caveat: the service sleeps after 15 min idle and takes ~1 min to wake. The webhook queue is in Postgres, and gateways retry, so nothing is lost; the worker just resumes on wake.

## 3. Gateway credentials
Run from your machine against Neon (secrets never go in git):
```
export DATABASE_URL='postgresql://...?sslmode=require' DB_SSL=true
npx ts-node scripts/seed-gateway-secrets.ts --gateway=PAYSTACK --api-key=sk_test_... --webhook-secret=sk_test_...
npx ts-node scripts/seed-gateway-secrets.ts --gateway=OPAY --api-key=<MerchantId> --webhook-secret=<secret> \
  --metadata='{"publicKey":"...","secretKey":"...","returnUrl":"https://<merchant-portal>.vercel.app/transactions/{transactionId}","callbackUrl":"https://<service>.onrender.com/api/v1/webhooks/opay"}'
npx ts-node scripts/seed-gateway-secrets.ts --gateway=INTERSWITCH --webhook-secret=<webhook secret> \
  --metadata='{"baseUrl":"https://sandbox.interswitchng.com","merchantCode":"MX...","payItemId":"Default_Payable_MX...","returnUrl":"https://<merchant-portal>.vercel.app/transactions/{transactionId}"}'
```

Interswitch has no server-side create-payment call: the payer is sent to `https://<service>.onrender.com/api/v1/checkout/interswitch/<id>`, which auto-submits Interswitch's hosted-checkout form. The backend's public URL comes from `metadata.publicBaseUrl`, else `PUBLIC_BASE_URL`, else Render's automatic `RENDER_EXTERNAL_URL`. Payment completion arrives via Interswitch's `TRANSACTION.COMPLETED` webhook (configure it in the Interswitch console to `.../api/v1/webhooks/interswitch`) or the 15-minute reconciliation poll.

Migration 014 seeds the gateway rows with sandbox base URLs and gateways disabled/enabled as configured; toggle them in the ops app.

## 4. Webhook URLs
- Paystack (dashboard > Settings > API Keys & Webhooks, test mode): `https://<service>.onrender.com/api/v1/webhooks/paystack`
- Opay: sent per payment as `callbackUrl` (above)

## 5. Frontends (Vercel)
Create two projects from the frontend repo, Root Directory `apps/ops` and `apps/merchant-portal`, "Include files outside root directory" enabled, install command `pnpm install`. Env var on each: `BACKEND_API_URL=https://<service>.onrender.com` (server-side only).

## 6. After the first deploy
- Log in to the ops app with the admin you seeded and create merchant users (Users page).
- Point the CI drift check at the new backend repo's `main` (see frontend `.github/workflows/ci.yml`).
