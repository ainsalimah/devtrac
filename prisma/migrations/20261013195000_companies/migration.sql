CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Company" ("id", "name")
VALUES ('00000000-0000-4000-8000-000000000001', 'Studio workspace');

ALTER TABLE "User" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Invitation" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Project" ADD COLUMN "companyId" TEXT;

UPDATE "User" SET "companyId" = '00000000-0000-4000-8000-000000000001';
UPDATE "Invitation" SET "companyId" = '00000000-0000-4000-8000-000000000001';
UPDATE "Project" SET "companyId" = '00000000-0000-4000-8000-000000000001';

ALTER TABLE "User" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Invitation" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "Project" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "User_companyId_idx" ON "User"("companyId");
DROP INDEX "Invitation_email_idx";
CREATE INDEX "Invitation_companyId_email_idx" ON "Invitation"("companyId", "email");
DROP INDEX "Project_key_key";
CREATE UNIQUE INDEX "Project_companyId_key_key" ON "Project"("companyId", "key");
CREATE INDEX "Project_companyId_idx" ON "Project"("companyId");
