-- CreateTable: Crawler Agent — full-site crawl sessions + per-page results.
-- Standard Postgres syntax generated to match this project's live datasource
-- (schema.prisma provider = "postgresql"). Run `prisma migrate deploy` (or
-- `prisma db push` in dev) after pulling this in, then `prisma generate` to
-- refresh the Python client.

CREATE TABLE "CrawlSession" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "errorMessage" TEXT,
    "pagesCrawled" INTEGER NOT NULL DEFAULT 0,
    "totalElements" INTEGER NOT NULL DEFAULT 0,
    "authAttempted" BOOLEAN NOT NULL DEFAULT false,
    "authSucceeded" BOOLEAN NOT NULL DEFAULT false,
    "durationSec" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CrawlSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrawlPage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "errorMessage" TEXT,
    "screenshotPath" TEXT,
    "elements" TEXT NOT NULL DEFAULT '[]',
    "elementCount" INTEGER NOT NULL DEFAULT 0,
    "crawledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "CrawlPage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrawlPage_sessionId_idx" ON "CrawlPage"("sessionId");

ALTER TABLE "CrawlPage" ADD CONSTRAINT "CrawlPage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CrawlSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;