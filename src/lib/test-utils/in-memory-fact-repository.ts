import type { FactRepository, StoredFact } from "../fact-repository";

type FactRow = StoredFact & { userId: string; movie: string };

/** In-memory FactRepository for tests: same contract as the Prisma version, backed by plain JS. */
export function createInMemoryFactRepository(users: Record<string, string | null>) {
  const favorites = new Map(Object.entries(users));
  const locks = new Map<string, Date>();
  const facts: FactRow[] = [];

  const repo: FactRepository = {
    async getFavoriteMovie(userId) {
      return favorites.get(userId) ?? null;
    },

    async findLatestFact(userId, movie) {
      const latest = facts
        .filter((f) => f.userId === userId && f.movie === movie)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return latest ? { fact: latest.fact, createdAt: latest.createdAt } : null;
    },

    async tryAcquireLock(userId, lockedAt, staleBefore) {
      // Check-and-set with no await in between, so it's atomic like the SQL UPDATE.
      const current = locks.get(userId);
      if (current && current >= staleBefore) return false;
      locks.set(userId, lockedAt);
      return true;
    },

    async releaseLock(userId, lockedAt) {
      if (locks.get(userId)?.getTime() === lockedAt.getTime()) locks.delete(userId);
    },

    async createFact(userId, movie, fact, createdAt) {
      facts.push({ userId, movie, fact, createdAt });
      return { fact, createdAt };
    },
  };

  return { repo, facts, favorites, locks };
}