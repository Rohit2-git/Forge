-- AlterTable: add category-split fields to TestResult
-- (see CATEGORY_CONFIG in server/app/services/llm_service.py — functional /
-- regression / data_driven / smoke_e2e / ui)
--
-- ADD COLUMN ... DEFAULT is valid syntax in both SQLite and Postgres, so this
-- migration works whichever schema (schema.sqlite.prisma / schema.postgresql.prisma)
-- is active at deploy time — same reasoning the existing migrations in this
-- folder already rely on.

ALTER TABLE "TestResult" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'functional';
ALTER TABLE "TestResult" ADD COLUMN "featureArea" TEXT;