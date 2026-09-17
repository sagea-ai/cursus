import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "@/app/generated/prisma/client";

// Single PrismaClient instance for the whole server process (PRD §10.1).
// Re-instantiating per request exhausts DB connections under load —
// the classic Next.js/Prisma footgun. Use this module everywhere;
// never `new PrismaClient()` elsewhere.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pool?: Pool;
};

function createClient(): PrismaClient {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at Postgres 16+.",
    );
  }
  const pool = globalForPrisma.pool ?? new Pool({ connectionString, max: 10 });
  if (!globalForPrisma.pool) globalForPrisma.pool = pool;
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env["NODE_ENV"] !== "production") globalForPrisma.prisma = db;
