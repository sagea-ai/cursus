// Prisma 7 config — datasource URL comes from env (see .env.example).
// Migrations live in prisma/migrations. Schema source of truth is
// prisma/schema.prisma (PRD §4, frozen at M0).
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
