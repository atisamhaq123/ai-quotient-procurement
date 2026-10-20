# Quotient Procurement

Multi-tenant AI procurement workspace built with Next.js, Supabase, and OpenAI. The project is independent of Orbit Sales. The interface uses a responsive graphite, cyan, and lime design.

## Local setup

1. Use Node 22 or newer, then run `npm install`.
2. Add the **new project's** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to `.env.local`. Do not use Orbit Sales' Supabase credentials.
3. Run `supabase/migrations/001_multitenant.sql` once in the new project's Supabase SQL editor.
4. In Supabase Authentication, enable email/password signup and email confirmation. Set the Site URL to `http://localhost:3200` and allow `http://localhost:3200/auth/callback` and `http://localhost:3200/auth/callback?next=/reset-password` as redirect URLs. For production, use the deployed HTTPS URL instead.
5. Keep `NEXT_PUBLIC_APP_URL=http://localhost:3200` for local development. Existing OpenAI and Stripe environment values are preserved in the ignored `.env.local` file.
6. Run `npm run dev` and open http://localhost:3200. Sign up, confirm your email, sign in, create an organization, and add a purchase request.

The SQL migration and real email delivery cannot be exercised against the new Supabase project until its credentials exist. Use Supabase's email templates with the PKCE `ConfirmationURL`, or the supported `token_hash` callback. Confirmation and recovery links must return to `/auth/callback`. Supabase's built-in email delivery can be used for development; configure production SMTP in Supabase when needed. No additional app environment variables are required.

## Accounts and tenancy

- `/login`, `/signup`, `/forgot-password`, and `/reset-password` implement email account flows.
- `/app` verifies the user on the server before rendering the signed-in application. API handlers independently verify current identity and organization membership.
- Each organization owns purchase requests, quotations, shortlists, AI reviews, invitations, and usage records.
- Row-level security applies to all application tables. Anonymous clients have no table access. Authenticated clients can only read organizations they belong to; writes use permission-checked SQL functions.
- Owners manage invitations and membership. Members can collaborate on purchasing records. An owner cannot be removed by the member-removal function.
- Invitations are email-bound, stored as SHA-256 hashes, single use, and expire after seven days. Share the generated link yourself; invitation emails are not sent by the app.
- A user may own up to five organizations. Each organization supports 20 members, 100 purchase requests, 10 quotes per request, and 200 items per quote.
- Version checks prevent another tab or teammate's saved changes being overwritten. Explicitly save edits before changing requests or asking AI.

## AI review

Signed-in members can review saved quotations through OpenAI. The server reads the tenant-scoped saved request instead of trusting browser-supplied quotation data. A database reservation enforces 20 reviews per UTC day per organization, including concurrent requests. Failed requests are released; a failed refund can leave the reservation counted for that day. Reviews write back only if the purchase version and requester membership still match. If the process terminates mid-request, its reservation remains counted for the day.

The model sees supplier names, references, quotation items, and terms. Totals are computed in code. AI output is advisory, not a purchase decision. Review supplier evidence before approving an order.

## Demo

`/demo` is explicitly separate from authentication and cloud data. Fictional records use the `quotient-demo-v2` browser-storage key. Demo AI uses labeled sample output and never calls paid APIs. No local records are silently imported into a live organization.

## Pricing and billing

This release uses a fixed free AI allowance. Stripe environment values are retained as requested, but subscription checkout, billing plans, and webhooks are not implemented. No charges are made.

## Checks

- `npm run build`: production compilation and TypeScript.
- `npm test`: cost/CSV validation and database tenant-isolation tests using embedded PostgreSQL (PGlite).
- `npm run test:browser`: responsive and interaction checks against localhost:3200. Set `CHROME_PATH` if Chrome is not at the standard Windows path. Screenshots are stored in `artifacts/`.

The database tests exercise actual SQL grants, RLS, organization boundaries, role escalation rejection, invitation matching, membership revocation, concurrent edits, and AI quotas. Browser tests cover authentication screens, protected routes, demo edits, CSV import, persistence, shortlisting, and responsive navigation. Live signup and recovery require the configured Supabase project.
