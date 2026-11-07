import type { PrismaClient } from "@prisma/client";

export type StoredFact = { fact: string; createdAt: Date };

/** All database operations the fact service needs. Tests use an in-memory version. */
export interface FactRepository {
  getFavoriteMovie(userId: string): Promise<string | null>;
  findLatestFact(userId: string, movie: string): Promise<StoredFact | null>;
  tryAcquireLock(userId: string, lockedAt: Date, staleBefore: Date): Promise<boolean>;
  releaseLock(userId: string, lockedAt: Date): Promise<void>;
  createFact(userId: string, movie: string, fact: string, createdAt: Date): Promise<StoredFact>;
}

export function createPrismaFactRepository(db: PrismaClient): FactRepository {
  return {
    async getFavoriteMovie(userId) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { favoriteMovie: true },
      });
      return user?.favoriteMovie ?? null;
    },

    async findLatestFact(userId, movie) {
      // Uses the (userId, movie, createdAt DESC) index.
      return db.movieFact.findFirst({
        where: { userId, movie },
        orderBy: { createdAt: "desc" },
        select: { fact: true, createdAt: true },
      });
    },

    async tryAcquireLock(userId, lockedAt, staleBefore) {
      // One atomic UPDATE: succeeds only if no one holds the lock (or it's expired).
      // Postgres guarantees only one concurrent request can win this.
      const { count } = await db.user.updateMany({
        where: {
          id: userId,
          OR: [
            { factGenerationStartedAt: null },
            { factGenerationStartedAt: { lt: staleBefore } },
          ],
        },
        data: { factGenerationStartedAt: lockedAt },
      });
      return count === 1;
    },

    async releaseLock(userId, lockedAt) {
      // Only clear the lock if it's still ours (it may have expired and been taken).
      await db.user.updateMany({
        where: { id: userId, factGenerationStartedAt: lockedAt },
        data: { factGenerationStartedAt: null },
      });
    },

    async createFact(userId, movie, fact, createdAt) {
      return db.movieFact.create({
        data: { userId, movie, fact, createdAt },
        select: { fact: true, createdAt: true },
      });
    },
  };
}