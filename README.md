# Chat App — Web

Next.js (App Router) web client for the Chat App messenger. You can sign in with an existing
account (accounts are created on the Android app), edit your profile, manage signed-in devices and
look up contacts by phone number.

Specs and plans live in the Spec Kit repo one level up (`../specs/`). The API lives in `../api`.

## Requirements

- Node.js 24, npm
- A running API (see `../api/README.md`)

## Run locally

```bash
cp .env.example .env.local    # NEXT_PUBLIC_API_URL=http://localhost:3000/v1
npm install
npm run dev                   # http://localhost:3001
```

The API must allow this origin: set `WEB_ORIGIN=http://localhost:3001` in the API's `.env`.
The refresh token is kept in an HttpOnly cookie set by the API, and the access token only in memory.

## Production (Render)

The web app is deployed by the Blueprint in the api repo (`render.yaml`); the full guide is in
`../api/README.md` under **Deploy to Render**. In production the browser never calls the API host
directly for REST:

| Variable                   | Example                         | Purpose                                                       |
| -------------------------- | ------------------------------- | ------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`      | `/v1`                           | Same-origin REST calls                                        |
| `API_PROXY_TARGET`         | `https://chat-api.onrender.com` | `next.config.ts` rewrites `/v1/*` to the API                  |
| `NEXT_PUBLIC_REALTIME_URL` | `https://chat-api.onrender.com` | Socket.IO connects to the API directly (bypasses the proxy)   |

The proxy keeps the refresh cookie first-party. Two `*.onrender.com` hosts are different sites,
so the API's `SameSite=strict` cookie would otherwise never be sent. All three values are read at
build time, so redeploy after changing them.

## Tests

```bash
npm run typecheck
npm run lint
npm test              # unit/component tests (Vitest + Testing Library, jsdom)
npm run test:e2e      # Playwright; starts the dev server itself
```

Playwright needs the API running locally with `NODE_ENV=development`, because it reads one-time codes
from `GET /v1/dev/last-otp`. The sign-in spec needs an existing account, which it creates through
the API as an Android device.

## API types

`src/lib/api/schema.d.ts` is generated from the contract:

```bash
npm run gen:api       # reads ../api/contracts/openapi.yaml
```

Regenerate it after every contract change, then fix the type errors.

## Layout

```
src/
  app/(auth)/sign-in/        phone → code
  app/(app)/layout.tsx       guarded shell: restores the session, opens the socket, handles device:revoked
  app/(app)/                 home, settings/profile, settings/devices, new-chat
  lib/api/                   generated schema, fetch client with single-flight refresh on 401
  lib/realtime/socket.ts     Socket.IO client for /rt
  stores/auth.ts             session state (Zustand)
  components/                shell, avatar, crop dialog, sign-in form
tests/                       Vitest tests; tests/e2e for Playwright
```
