# Deploy Atrium on Vercel (Hobby / free)

Two Vercel projects from one repo. Docker (`docker compose up`) is **untouched**
and remains the local assessment environment with 3 API replicas + nginx LB.

| Project | Root Directory in Vercel | Serves |
| --- | --- | --- |
| `atrium-api`   | `backend`  | Express API as a Vercel Function (`api/index.ts`) |
| `atrium` web   | `frontend` | React/Vite static app (SPA rewrites via `frontend/vercel.json`) |

## Why this shape

- In-process paygate: set `PAYGATE_URL` / `PAYGATE_CALLBACK_URL` to the API
  project URL so charge/refund/webhook self-calls work serverless.
- No long-lived worker on Vercel, so `backend/api/index.ts` runs lazy
  hold-expiry/booking-completion on each request (same `FOR UPDATE SKIP LOCKED`
  batch services the worker used) plus a daily `/api/cron` (Hobby max).
- Raw body is preserved (`api.bodyParser: false`) so the paygate webhook HMAC
  check still works.

## 1. Backend project (atrium-api)

Dashboard → New Project → import the repo → **Root Directory: `backend`**.

Env vars (set in Vercel project Settings → Environment Variables):

| Name | Example / notes |
| --- | --- |
| `DATABASE_URL` | Neon direct URL: `postgresql://USER:PASS@HOST/db?sslmode=require` |
| `JWT_SECRET` | long random string |
| `PAYGATE_SECRET` | long random HMAC secret |
| `PAYGATE_CHAOS` | `on` (demo the failure paths) |
| `PAYGATE_URL` | `https://<your-api>.vercel.app` |
| `PAYGATE_CALLBACK_URL` | `https://<your-api>.vercel.app/api/paygate/webhook` |
| `CORS_ORIGIN` | `https://<your-web>.vercel.app` |
| `CRON_SECRET` | long random string (protects `/api/cron`) |
| `NODE_ENV` | `production` |
| `INSTANCE_ID` | `vercel` |
| `RUN_WORKER` | `false` (no 2s loop; the adapter handles it) |

`DATABASE_URL` / `JWT_SECRET` / `PAYGATE_SECRET` / `CRON_SECRET` are required —
never commit them; paste them in the dashboard.

## 2. Frontend (web)

Dashboard → New Project → Import repo → **Root Directory: `frontend`**.

- Variable: `VITE_API_URL=https://<your-api>.vercel.app` (set in Settings so the
  build bakes it in).

## 3. Database (Neon)

1. Create a free Neon project → copy the **direct** connection URL (not pooled).
2. From your machine, once, against the same `DATABASE_URL`:

   ```
   cd backend
   npx prisma migrate deploy
   npm run prisma:seed -- --profile=demo
   ```

   Demo logins (password `Password123!`): `customer@`, `staff@`, `admin-a@`,
   `admin-b@`, `platform@` (all `@atrium.local`). Never run `--profile=full`
   against the deployed DB (that is the local benchmark profile).

## Verify

- `GET https://<your-api>.vercel.app/health` → `{"status":"ok",...}`
- Open `https://<your-web>.vercel.app/` and log in with a seeded account.
- Cron runs `/api/cron` daily at 04:00 UTC (Hobby limit).