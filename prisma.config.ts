// Prisma 7 config — datasource URL comes from env (see .env.example).
// Migrations live in prisma/migrations. The schema file is the source of
// truth for the data model and its design notes.
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
