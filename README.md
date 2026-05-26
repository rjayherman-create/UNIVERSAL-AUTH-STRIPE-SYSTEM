# Universal Auth + Stripe System

Drop-in auth + billing backend for apps.

## Stack

- Express
- JWT auth in HTTP-only cookie
- PostgreSQL
- Drizzle ORM
- Stripe checkout + webhook
- Railway-friendly startup and health route

## Setup

1. Install packages:

   ```bash
   pnpm install
   ```

2. Create env file:

   ```bash
   copy .env.example .env
   ```

3. Run in development:

   ```bash
   pnpm dev
   ```

4. Build and run production:

   ```bash
   pnpm build
   pnpm start
   ```

## Healthcheck

- `GET /health`

## API Vault (Encrypted Key Storage)

The app now includes an encrypted API Vault for storing keys by app name and key name.

Important:

- No system is "totally secure" in absolute terms.
- This vault uses AES-256-GCM encryption with your master key and admin-only endpoints.

Setup:

1. Generate a master key:

    ```bash
    pnpm vault:gen-key
    ```

2. Put that output into `.env` as `VAULT_MASTER_KEY`.
3. Restart the backend server.

Endpoints (admin-protected):

- `GET /api/vault/keys` list stored keys metadata (never returns plaintext values)
- `POST /api/vault/keys` upsert a key:
   - body: `{ "appSlug": "my-app", "keyName": "openai", "secretValue": "sk-..." }`
- `POST /api/vault/resolve` resolve and decrypt one key for runtime use:
   - body: `{ "appSlug": "my-app", "keyName": "openai" }`
- `DELETE /api/vault/keys/:id` delete a stored key

Security notes:

- Keep `VAULT_MASTER_KEY` only in environment variables.
- Rotate the key periodically and re-encrypt entries as part of a maintenance process.
- Use HTTPS in production and keep admin access tightly controlled.

## Security and Privacy

This section explains how the system protects user data and how scanning works.

### API Security Measures

- Authentication uses JWT stored in HTTP-only cookies.
- Protected routes require authentication middleware before access.
- Premium and credit-based routes enforce plan and usage checks.
- Stripe webhooks are signature-verified before processing.
- Vault endpoints require authenticated admin access.
- API vault secrets are encrypted at rest using AES-256-GCM and your `VAULT_MASTER_KEY`.
- CORS is restricted to your configured client origin.

### Scanner Data Policy

- The scanner reads local project structure and configuration to generate setup guidance.
- Scanner output is used only for local integration planning and recommendations.
- The scanner does not automatically send project scan data to external services.
- The scanner does not automatically push secrets into third-party systems.
- Secret values should remain in environment variables and encrypted vault storage.

### Plain-Language Promise

- We use scan data to help configure your app, not to collect user data.
- You control your keys through environment variables and encrypted vault storage.
- Security-sensitive actions require authenticated access controls.

Relevant implementation files:

- `src/server.ts`
- `src/scanner.ts`
- `scripts/sync-railway-env.ps1`

## Secure Railway Variable Sync

You can sync local `.env` values to Railway without manually pasting each secret.

1. Login and link once:

   ```bash
   railway login
   railway link
   ```

2. Sync a safe allowlist from `.env`:

   ```bash
   pnpm railway:sync-env
   ```

3. Optional: target a specific service/environment/project:

   ```bash
   powershell -ExecutionPolicy Bypass -File scripts/sync-railway-env.ps1 -Service api -Environment production
   ```

Notes:

- Script file: `scripts/sync-railway-env.ps1`
- It uses `railway variable set KEY --stdin` so values are not passed as plain CLI arguments.
- Only an allowlist of app keys is synced.
- `.env` stays local; never commit secret values.

## App Scanner + Auto Integration Engine

Run the scanner to detect stack, auth, billing, deployment, and env setup before integrating new modules:

```bash
pnpm scan:app
```

Scanner source:

- `src/scanner.ts`

The scanner prints:

- detected stack
- install strategy
- warnings
- recommendations
- repair issues

## Notes

- `DEV_BYPASS_AUTH=true` injects a dev admin user for protected routes.
- Stripe webhook route uses raw body parser and should be configured with your endpoint secret.
