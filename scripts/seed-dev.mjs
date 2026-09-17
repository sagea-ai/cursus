// Dev-only seed for M1 ingestion verification (proper org bootstrap + invite
// flow land in M2). Creates one org, one super-admin user, and prints a
// plaintext API key for SDK testing. Raw SQL via pg — no TS compilation
// needed. Never run against production.
//
// Usage: DATABASE_URL=... node scripts/seed-dev.mjs
import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import pg from "pg";

// Load repo .env (DATABASE_URL) when not already in the environment.
process.loadEnvFile?.();

const { Client } = pg;

const email = process.env["SEED_EMAIL"] ?? "dev@cursus.local";
const plaintext = `cursus_${randomBytes(32).toString("base64url")}`;
const cuid = (p) => `${p}_${randomBytes(12).toString("base64url")}`;

const client = new Client({ connectionString: process.env["DATABASE_URL"] });
await client.connect();

await client.query(
  `INSERT INTO "Org" ("id", "name") VALUES ('seed-org', 'dev')
   ON CONFLICT ("id") DO NOTHING`,
);

const pw = await bcrypt.hash("cursus-dev", 10);
const userRes = await client.query(
  `INSERT INTO "User" ("id", "orgId", "email", "passwordHash", "role")
   VALUES ($1, 'seed-org', $2, $3, 'SUPER_ADMIN')
   ON CONFLICT ("email") DO UPDATE SET "email" = EXCLUDED."email"
   RETURNING "id"`,
  [cuid("user"), email, pw],
);
const userId =
  userRes.rows[0]?.id ??
  (await client.query(`SELECT "id" FROM "User" WHERE "email" = $1`, [email]))
    .rows[0].id;

await client.query(
  `INSERT INTO "ApiKey" ("id", "orgId", "userId", "keyHash", "label")
   VALUES ($1, 'seed-org', $2, $3, 'dev-seed')`,
  [
    cuid("key"),
    userId,
    createHash("sha256").update(plaintext).digest("hex"),
  ],
);

console.log(`org: seed-org\nuser: ${email}\nCURSUS_API_KEY=${plaintext}`);
await client.end();
