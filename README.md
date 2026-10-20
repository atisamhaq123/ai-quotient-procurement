# Quotient Procurement

Quotient is a multi-tenant AI procurement workspace for collecting supplier quotations, comparing costs and commercial terms, routing purchasing decisions, and keeping an organization-scoped audit trail. It is built with Next.js, Supabase, OpenAI, and Stripe.

## Current features

- Email signup, login, password recovery, and safe invitation redirects.
- Multiple organizations with isolated data, owner/member roles, and row-level security.
- Email-bound, expiring invitation links with revocation, member removal, and ownership transfer.
- Purchase request search, status filters, duplication, JSON snapshots, and CSV import/export.
- Structured supplier quotations with line items, shipping, tax, delivery, terms, and currency-aware totals.
- Shortlisting plus Draft, Review, Approved, Rejected, and Archived approval states.
- Optimistic version checks that prevent teammates from overwriting newer changes.
- Organization audit history for purchasing, membership, AI, and billing events.
- OpenAI-assisted quotation reviews grounded in saved quote data and protected by plan quotas.
- Stripe Checkout, customer portal access, signed webhooks, 14-day Starter trials, and server-enforced entitlements.
- Responsive desktop/mobile workspace, accessible desktop typography, dark product UI, and a browser-local demo.
- Nonce-based CSP, bounded request parsing, server timeouts, security headers, and secret-leak checks.

## Plans

| Capability | Starter | Pro |
| --- | ---: | ---: |
| Organization members | 3 | 20 |
| Purchase requests | 50 | 500 |
| AI reviews per UTC day | 10 | 50 |
| Approvals and audit history | Included | Included |

New organizations receive a 14-day Starter trial. If a subscription or trial lapses, existing records remain readable and exportable, while edits, new requests, invitations, status changes, deletions, and AI reviews pause. Only organization owners can manage billing.

## Getting started

### Prerequisites

- Node.js 24 and npm.
- A fresh Supabase project, or an existing Quotient database upgraded through schema version 3.
- An OpenAI API key and chat model with access enabled.
- A Stripe account with separate recurring Quotient Starter and Pro prices.
- For production: an HTTPS domain, transactional email delivery, and a public Stripe webhook endpoint.

Do not reuse price IDs whose Stripe product names belong to another application. Checkout displays the Stripe product name to customers.

### 1. Install dependencies

```powershell
npm ci
```

### 2. Configure environment variables

Create `.env.local` and set:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3200
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

OPENAI_API_KEY=
OPENAI_CHAT_MODEL=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_STARTER_PRICE_ID=
STRIPE_PRO_PRICE_ID=

# Optional: used by browser tests when Chrome is not auto-detected.
CHROME_PATH=
```

Only `NEXT_PUBLIC_*` values may reach browser code. Never commit `.env.local`, expose the Supabase service-role key, or expose Stripe/OpenAI secrets.

### 3. Initialize Supabase

For a fresh Supabase project, run exactly one file in the Supabase SQL Editor:

```text
supabase/migrations/001_setup.sql
```

It installs the complete schema in one transaction: organizations, memberships, purchasing workflow, RLS, invitations, audit history, AI reservations, Stripe subscription state, plan limits, and schema version 4.

For an existing database that already ran the former migrations 001, 002, and 003, run only:

```text
supabase/legacy-migrations/004_stripe_billing.sql
```

Do not run `001_setup.sql` over an existing schema. Files under `supabase/legacy-migrations/` are upgrade/history files and are not part of fresh setup.

### 4. Configure Supabase Auth

- Set the Supabase Site URL to `NEXT_PUBLIC_APP_URL`.
- Allow `/auth/callback` and the reset-password callback under the same origin.
- Keep email/password authentication enabled.
- Local testing may use automatic confirmation. Enable email confirmation and configure SMTP before public launch because invitations rely on ownership of the invited email address.

### 5. Configure Stripe

Create recurring Starter and Pro prices for Quotient and place their `price_...` IDs in `.env.local`. Configure the Stripe customer portal for subscription changes and cancellations.

Register this webhook endpoint:

```text
POST https://YOUR_DOMAIN/api/stripe/webhook
```

Subscribe it to:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Store that endpoint's signing secret as `STRIPE_WEBHOOK_SECRET`. Subscription access changes only after a signed webhook is accepted. Delivery is idempotent, and older events cannot overwrite newer subscription state.

### 6. Start the app

```powershell
npm run dev
```

Open http://localhost:3200. Use `/demo` for fictional browser-local data and simulated AI; demo actions never consume OpenAI or Stripe resources.

### 7. Confirm readiness

A working local setup should meet all of these criteria:

- Signup/login reaches the workspace and an organization can be created.
- `schema_versions` contains version 4.
- Two saved quotations can be compared and submitted through the approval workflow.
- An AI review succeeds and increments the organization allowance.
- An owner can open Stripe Checkout, and a test subscription webhook updates the workspace plan.
- A second organization cannot read the first organization's records.
- `npm test`, `npm run typecheck`, and `npm run build` pass.

## Purchasing and AI behavior

Decimal.js rounds each line extension and item tax half-up to two decimals, then adds shipping. Tax excludes shipping. Prices, shipping, and tax percentages allow two decimals; quantities allow three; delivery days are whole numbers. Currencies are never converted, and matching item names do not prove equivalent specifications.

The AI route authenticates the user, verifies organization membership, reloads the saved purchase request, limits serialized input to 60 KB, and reserves usage atomically. Only one review can run per request; stale reservations expire after two minutes. Deleting a request does not restore consumed allowance. AI output is advisory, cannot place orders, and saves only if membership and purchase version remain valid.

Live data is stored in organization-scoped Supabase tables. Unsaved drafts remain in memory with unload protection and JSON backup controls. The `/demo` route uses fictional local data and simulated AI only.

## Security model

- PostgreSQL RLS and permission-checked security-definer functions enforce tenancy, ownership, workflow state, billing access, quotas, and version checks.
- Anonymous table access is denied. Internal Stripe mutation functions are callable only by the service role.
- Stripe webhook signatures are verified before subscription data is written; event IDs and timestamps prevent duplicate and stale updates.
- AI requests are bounded, deduplicated, time-limited, and checked again before results are persisted.
- API errors include correlation IDs without logging request bodies or credentials.
- CSP uses per-request nonces and `strict-dynamic`; frame, MIME, referrer, permissions, cache, and HTTPS headers are configured centrally.
- CSV parsing is structured and exported cells are protected against spreadsheet formulas.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server on `127.0.0.1:3200` |
| `npm test` | Run 11 domain, security, migration, tenancy, billing, and validation tests |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm run build` | Create and validate the production build |
| `npm start` | Start the production server using `PORT` and optional `HOST` |
| `npm run test:browser` | Exercise responsive auth and demo workflows in Chrome |
| `npm run test:live` | Run destructive, self-cleaning QA against the configured Supabase project |
| `npm run check:production` | Validate production configuration and write the readiness report |

`npm run test:live` creates temporary users and organizations, then removes them. Set `QUOTIENT_LIVE_AI_CHECK=1` only when one small billable OpenAI request is acceptable. The readiness command writes `artifacts/production-readiness.json` and returns a nonzero exit code for launch blockers.

## Production deployment

Run `npm run build`, then `npm start`. The server uses `PORT` and optional `HOST`; defaults are port 3200 and `0.0.0.0`. Public production must use HTTPS, an exact `NEXT_PUBLIC_APP_URL`, matching Supabase redirect URLs, and a reachable Stripe webhook.

Before launch, enable confirmed email, verify signup and recovery delivery, configure Supabase backups and perform a restore test, configure Stripe portal behavior and webhook retries, validate Starter and Pro purchases in Stripe test mode, connect logs/alerts and uptime monitoring to `/api/health`, and publish support, privacy, billing, cancellation, and retention policies.

The health endpoint is liveness-only. Run the production readiness check for dependencies and configuration. Host timeouts must allow the 60-second AI route. Account deletion, source PDF/image storage, OCR, JSON re-import, and purchase-order dispatch are not implemented in this release.
