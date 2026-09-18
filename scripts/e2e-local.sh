#!/usr/bin/env bash
# Local E2E runner: recreates the throwaway e2e database, migrates, builds if
# needed, and runs Playwright. Never touches dev/prod databases.
set -euo pipefail

E2E_DB_URL="${E2E_DATABASE_URL:-postgresql://cursus:cursus@localhost:5432/cursus_e2e?schema=public}"

node --input-type=module -e "
import pg from 'pg';
const admin = new pg.Client({ connectionString: 'postgresql://cursus:cursus@localhost:5432/cursus?schema=public' });
await admin.connect();
await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = \$1 AND pid <> pg_backend_pid()', ['cursus_e2e']);
await admin.query('DROP DATABASE IF EXISTS cursus_e2e');
await admin.query('CREATE DATABASE cursus_e2e');
await admin.end();
console.log('recreated cursus_e2e');
"

DATABASE_URL="$E2E_DB_URL" npx prisma migrate deploy
# next start serves the production build — rebuild so UI/API changes apply.
npm run build
# The journey drives real onboarding: the bootstrap identity comes from env.
export BOOTSTRAP_ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-admin@e2e.test}"
export BOOTSTRAP_ORG_NAME="${BOOTSTRAP_ORG_NAME:-E2E Org}"
E2E_DATABASE_URL="$E2E_DB_URL" npx playwright test "$@"
