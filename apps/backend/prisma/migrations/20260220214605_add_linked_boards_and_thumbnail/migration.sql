-- AlterTable
ALTER TABLE "Board" ADD COLUMN     "thumbnail" TEXT;

-- CreateTable
CREATE TABLE "LinkedBoard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedBoard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinkedBoard_userId_idx" ON "LinkedBoard"("userId");

-- CreateIndex
CREATE INDEX "LinkedBoard_boardId_idx" ON "LinkedBoard"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedBoard_userId_boardId_key" ON "LinkedBoard"("userId", "boardId");

-- AddForeignKey
ALTER TABLE "LinkedBoard" ADD CONSTRAINT "LinkedBoard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedBoard" ADD CONSTRAINT "LinkedBoard_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
