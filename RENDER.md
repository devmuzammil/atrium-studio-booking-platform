# Deploy Atrium API on Render (Hobby / free)

This is a **backend-only** Render setup. Use Neon (or another free Postgres)
for `DATABASE_URL`. Do not attach a paid Render Postgres instance.

Paygate is in-process. Leave `PAYGATE_URL` and `PAYGATE_CALLBACK_URL` unset so
they default to `127.0.0.1:$PORT` on the same service.

## 1. Database (Neon)

1. Create a free Neon project.
2. Copy the **direct** (not pooled) connection string.
3. Append `?sslmode=require` if it is missing.
4. Optional, keep the pool small on 512 MB RAM:

```
postgresql://USER:PASSWORD@HOST/DB?sslmode=require&connection_limit=5
```

Use the unpooled/direct host for migrations. Prisma migrate is unreliable through
Neon’s PgBouncer pooler.

## 2. Create the web service

**Option A — Blueprint**

1. Push this repo to GitHub.
2. In Render: New → Blueprint → select the repo.
3. Fill `DATABASE_URL` and `CORS_ORIGIN` (your frontend origin, or `*` for now).
4. Deploy.

**Option B — Dashboard**

1. New → Web Service → this repo.
2. Root directory: `backend`
3. Runtime: Node
4. Instance: Free
5. Build command: `npm ci --include=dev && npm run build`
6. Start command: `npm run start:prod`
7. Health check path: `/health`

`npm ci --include=dev` is required so TypeScript can compile. Prisma CLI is a
production dependency so `migrate deploy` works at boot.

## 3. Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon direct URL + `sslmode=require` |
| `JWT_SECRET` | yes | Blueprint can generate this |
| `PAYGATE_SECRET` | yes | HMAC secret for webhooks |
| `NODE_ENV` | yes | `production` |
| `RUN_WORKER` | no | default on; set `false` to disable hold expiry |
| `PAYGATE_CHAOS` | no | assessment default on Render: `on` |
| `CORS_ORIGIN` | no | frontend origin; `*` if unset |
| `INSTANCE_ID` | no | `render` |
| `PORT` | no | Render sets this |

Do **not** set `PAYGATE_URL` / `PAYGATE_CALLBACK_URL` to `localhost:3000`.
Render assigns `PORT`. Unset is correct.

## 4. What start does

`npm run start:prod` runs:

1. `prisma migrate deploy`
2. `node dist/server.js` on `0.0.0.0:$PORT`
3. an in-process hold-expiry loop (`FOR UPDATE SKIP LOCKED`)

A second Render worker is not used. Hobby is one web process; expiry is safe
across later replicas because locking lives in Postgres.

## 5. Seed demo data (one-off, from your machine)

Do not seed inside the Render start command. The demo profile is large enough
to time out a 512 MB boot.

From the repo, with the **same** `DATABASE_URL` as Render:

```powershell
cd backend
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
$env:JWT_SECRET="unused-for-seed"
npm ci
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed -- --profile=demo
```

Demo logins (password `Password123!`):

- `customer@atrium.local`
- `staff@atrium.local`
- `admin-a@atrium.local`
- `admin-b@atrium.local`
- `platform@atrium.local`

## 6. Verify

After deploy:

```
GET https://YOUR-SERVICE.onrender.com/health
```

Expect `{"status":"ok",...}`. The first request after idle may take 30–60s
because free Render sleeps.

## Not included

- Frontend hosting (Vercel/Netlify/Cloudflare Pages)
- Render Postgres (expires / not used)
- Claiming a live URL until you actually deploy
