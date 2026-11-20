# ANILIX — Vercel + Supabase migration branch

This branch is the cloud-backend migration work in progress. The existing `main` branch is not modified.

## Architecture
- **Vercel:** serves the existing static frontend and the catch-all Express API at `api/[...path].js`.
- **Supabase PostgreSQL:** stores users, EXP history, favorites, watch history, and private server sessions.
- **GitHub:** source control and deployment trigger.
- **No VPS is required** for this deployment path.

The existing `server.js` remains the local SQLite development server. Vercel uses `api/[...path].js`, which talks to PostgreSQL. Do not use `npm start` as a production deployment command on Vercel.

## Supabase schema
The project database must contain:
- `public.users`
- `public.exp_history`
- `public.favorites`
- `public.watch_history`
- `private.user_sessions`

The four `public` tables have RLS enabled and intentionally have no public policies. The Vercel API connects server-side using the PostgreSQL connection string. The session table is in the unexposed `private` schema, with access revoked from `PUBLIC`, `anon`, and `authenticated`.

Never put a Supabase database password, service-role key, or SANKA provider key in frontend JavaScript or Git.

## Vercel environment variables
See `.env.example` for the variable names and formats. Set actual values in **Vercel → Project → Settings → Environment Variables**:
- `DATABASE_URL`: Supabase PostgreSQL connection string; use the Supabase pooler for serverless deployments.
- `DATABASE_SSL=true`
- `SESSION_SECRET`: random secret of at least 32 characters.
- `GOOGLE_CLIENT_ID`: the same OAuth Web Client ID used by Google Identity Services in the frontend.
- `SANKA_API_BASE_URL` and optional `SANKA_API_KEY`.
- Optional `TESTER_1_*` through `TESTER_10_*` values for developer test accounts.

Do not paste credentials into chat, commit them, or put them in any `NEXT_PUBLIC_*` variable. After adding or changing environment variables, redeploy the Vercel project.

## API routes migrated to PostgreSQL
- `GET /api/system/status`
- `GET /api/config/roles`, `/api/config/levels`, `/api/config/exp`
- `POST /api/auth/login`, `POST /api/auth/google`, legacy `POST /api/auth/google-user`
- `GET /api/auth/me`, `GET /api/me`, `POST /api/auth/logout`
- `GET /api/nixgem/balance`
- `GET /api/premium/packages`, `POST /api/premium/checkout` (checkout remains intentionally disabled with 503)
- `GET /api/progression/me`, `POST /api/admin/users/:id/progression`
- `GET/POST/DELETE /api/user/favorites`
- `GET/POST/DELETE /api/user/history`
- `GET /api/catalog` (server-side SANKA proxy)

The tester seed runs once per warm serverless instance and does not reset EXP on existing tester accounts. Test accounts without a configured password cannot log in.

## Important limitations before production
- **Existing SQLite user data has not been copied into Supabase.** Do not assume accounts, favorites, or history from a local SQLite database are already present in the cloud.
- **Automatic watch-time EXP is not implemented.** The JSON config describes anti-abuse requirements, but the backend still needs a server-validated playback heartbeat/reward design. Clients cannot submit arbitrary EXP.
- **Premium checkout is not active.** No payment is accepted and no Premium/NixGem should be granted before verified payment webhooks exist.
- **Google OAuth domains and redirect/origin settings must be updated for the final Vercel domain.**
- **SANKA catalog requires valid server environment variables** and should be tested against the provider's actual API contract.
- The existing static frontend has not yet received an end-to-end browser test on Vercel.

## Local development
The legacy `server.js` continues to use SQLite for local development:
1. Copy `.env.example` to `.env` and set a strong local `SESSION_SECRET`.
2. Run `npm install`.
3. Run `npm start` and open `http://localhost:3000`.

The cloud API branch requires `DATABASE_URL` and `SESSION_SECRET` at runtime.

## Deployment status
**Not yet production-ready.** The PostgreSQL API handler and Vercel function configuration are in place, and the Supabase private session table has been created. A deployment smoke test, end-to-end authentication test, existing SQLite data migration (if needed), and frontend compatibility checks are still required before using this as the live ANILIX service.
