import type { FactRepository, StoredFact } from "./fact-repository";
import type { FactGenerator } from "./openai";

export const CACHE_WINDOW_MS = 60_000; // facts younger than this are reused
export const LOCK_TIMEOUT_MS = 30_000; // a lock older than this is treated as abandoned

export type FactResult =
  | { status: "fresh" | "generated" | "stale"; fact: string; createdAt: Date }
  | { status: "generating" }
  | { status: "unavailable"; message: string };

type Deps = {
  repo: FactRepository;
  generate: FactGenerator;
  now?: () => Date; // injectable clock so tests can control time
};

const isFresh = (f: StoredFact, now: Date) =>
  now.getTime() - f.createdAt.getTime() < CACHE_WINDOW_MS;

export async function getFactForUser(
  userId: string,
  { repo, generate, now = () => new Date() }: Deps
): Promise<FactResult> {
  const movie = await repo.getFavoriteMovie(userId);
  if (!movie) return { status: "unavailable", message: "Set a favorite movie to get a fun fact." };

  // 1. Cache hit: the latest fact for this user + movie is under 60 seconds old.
  const latest = await repo.findLatestFact(userId, movie);
  if (latest && isFresh(latest, now())) return { status: "fresh", ...latest };

  // 2. Try to become the one request allowed to generate.
  const lockedAt = now();
  const staleBefore = new Date(lockedAt.getTime() - LOCK_TIMEOUT_MS);
  const acquired = await repo.tryAcquireLock(userId, lockedAt, staleBefore);

  if (!acquired) {
    // Another request (e.g. another tab) is generating right now.
    return latest ? { status: "stale", ...latest } : { status: "generating" };
  }

  try {
    // 3. Re-check: a request may have finished generating just before we got the lock.
    const recheck = await repo.findLatestFact(userId, movie);
    if (recheck && isFresh(recheck, now())) return { status: "fresh", ...recheck };

    // 4. Generate, store, return.
    const text = await generate(movie);
    const created = await repo.createFact(userId, movie, text, now());
    return { status: "generated", ...created };
  } catch (error) {
    // 5. OpenAI failed or timed out: fall back to the most recent fact if we have one.
    console.error("Fact generation failed:", error);
    return latest
      ? { status: "stale", ...latest }
      : { status: "unavailable", message: "We couldn't get a fun fact right now. Please try again in a moment." };
  } finally {
    // 6. Always release the lock, success or failure.
    await repo.releaseLock(userId, lockedAt).catch((e) => console.error("Failed to release lock:", e));
  }
}