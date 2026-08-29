# NorthRiver Payments API — Deployment Runbook

## Target Environment

**Environment:** Production

## Runtime Requirements

- **Node.js:** 18
- **npm:** 8.x or later

## Deployment Steps

1. SSH into the production host.
2. Pull the latest release tag.
3. Install production dependencies: `npm install --production`
4. Start the application: `npm run production`
5. Verify the health endpoint returns HTTP 200: `GET /health`

## Environment Variables

All environment variables must be set before starting the service.

| Variable               | Required | Description                        |
|------------------------|----------|------------------------------------|
| `PORT`                 | Yes      | TCP port the server listens on     |
| `NODE_ENV`             | Yes      | Must be `production`               |
| `DATABASE_URL`         | Yes      | PostgreSQL connection string       |

## Rollback

If the deployment fails, restore the previous release tag and restart.

No rollback SQL is required for patch releases.
