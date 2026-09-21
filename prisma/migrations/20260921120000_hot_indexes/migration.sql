-- Hot-path indexes (API audit): project-scoped ordered scans and
-- case-insensitive name search. All CONCURRENTLY-safe shapes, plain
-- CREATE INDEX (migrations run in a transaction; CONCURRENTLY is
-- incompatible with it — brief write lock on deploy is accepted).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- listRuns "recent"/"oldest": filter projectId + order (startedAt, id).
CREATE INDEX "Run_projectId_startedAt_idx" ON "Run"("projectId", "startedAt");

-- listRuns name_asc/name_desc: filter projectId + order (name, id).
CREATE INDEX "Run_projectId_name_idx" ON "Run"("projectId", "name");

-- Substring run search (ILIKE %q%): trigram GIN on name.
CREATE INDEX "Run_name_trgm_idx" ON "Run" USING gin ("name" gin_trgm_ops);
