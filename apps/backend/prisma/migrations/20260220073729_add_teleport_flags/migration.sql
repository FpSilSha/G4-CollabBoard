-- CreateTable
CREATE TABLE "TeleportFlag" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeleportFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeleportFlag_boardId_idx" ON "TeleportFlag"("boardId");

-- AddForeignKey
ALTER TABLE "TeleportFlag" ADD CONSTRAINT "TeleportFlag_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeleportFlag" ADD CONSTRAINT "TeleportFlag_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
