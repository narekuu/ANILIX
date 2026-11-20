# ANILIX — Vercel + Supabase migration branch

This branch is the cloud-backend migration work in progress. The existing `main` branch is not modified.

## Architecture
- **Vercel:** detects the root Express app exported from `index.js`; frontend files are served from the Vercel `public/` directory through its CDN.
- **Supabase PostgreSQL:** stores users, EXP history, favorites, watch history, and private server sessions.
- **GitHub:** source control and deployment trigger.
- **No VPS is required** for this deployment path.

The existing `server.js` remains the local SQLite development server. Vercel uses the root `index.js` entrypoint, which exports the PostgreSQL-backed Express app from `api/_app.js`. The Vercel copy of the frontend is mirrored under `public/`: `public/index.html`, `public/css/`, `public/js/`, and `public/json/`. The files under `public/` are served at the site root, so the copied home page uses `/profile.html`, `/anime.html`, and similar root-level paths. Do not use `npm start` as a production deployment command on Vercel.

## Supabase schema
The project database must contain:
- `public.users`
- `public.exp_history`
- `public.favorites`
- `public.watch_history`
- `private.user_sessions`

The four `public` tables have RLS enabled and intentionally have no public policies. The Vercel API connects server-side using the PostgreSQL connection string. The session table is in the unexposed `private` schema, with RLS enabled and access revoked from `PUBLIC`, `anon`, and `authenticated`. No client-side RLS policies are needed because the trusted server connects directly to PostgreSQL.

Never put a Supabase database password, service-role key, or SANKA provider key in frontend JavaScript or Git.

## Vercel environment variables
See `.env.example` for the variable names and formats. Set actual values in **Vercel → Project → Settings → Environment Variables**:
- `DATABASE_URL`: Supabase PostgreSQL connection string; use the Supabase pooler for serverless deployments.
- `DATABASE_SSL=true`
- `SESSION_SECRET`: random secret of at least 32 characters.
- `GOOGLE_CLIENT_ID`: the same OAuth Web Client ID used by Google Identity Services in the frontend.
- `SANKA_API_BASE_URL` and optional `SANKA_API_KEY`.
- `TESTER_SEED_ENABLED=false` by default; only enable developer test-account seeding intentionally.

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

Developer test-account seeding is disabled by default. To enable it intentionally, set `TESTER_SEED_ENABLED=true` and provide a password or password hash for each tester account. Seeding is insert-only: it never promotes or overwrites an existing account. Do not enable this for production users.

## Important limitations before production
- **Existing SQLite user data is not copied automatically.** An optional migration script is available: before the first request reaches the deployed API (so the tester seed has not populated Supabase), set `DATABASE_URL` in a local `.env`, make sure the original `database/anilix.db` is present, then run `npm run migrate:sqlite`. It copies users (including password hashes), EXP history, favorites, and watch history in one database transaction. It refuses to run if the Supabase target tables already contain data. Back up the SQLite file first. Do not upload the database file to GitHub or paste credentials into chat.
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

The cloud API branch requires `DATABASE_URL` and `SESSION_SECRET` at runtime. Its Vercel Function is configured for `hnd1` (Tokyo), near the Supabase Tokyo region.

## Deployment status
**Not yet production-ready.** The PostgreSQL Express app, root Vercel entrypoint, static asset mirror, Vercel function configuration, and Supabase private session table are in place. A deployment smoke test, end-to-end authentication test, existing SQLite data migration (if needed), and frontend compatibility checks are still required before using this as the live ANILIX service.
