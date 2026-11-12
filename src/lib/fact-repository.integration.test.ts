import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaFactRepository } from "./fact-repository";
import { getFactForUser, LOCK_TIMEOUT_MS } from "./facts";

/**
 * Integration tests for the generation lock against a REAL Postgres database.
 *
 * Skipped unless TEST_DATABASE_URL is set, so `npm test` stays fast and offline.
 * Point TEST_DATABASE_URL at a dedicated, disposable database: these tests delete its data.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("generation lock (real Postgres)", () => {
  // Several clients = several independent connection pools,
  // which is how several app servers would hit the database.
  const clients = Array.from({ length: 5 }, () => new PrismaClient({ datasourceUrl: url }));
  const db = clients[0];
  let userId: string;

  beforeEach(async () => {
    await db.movieFact.deleteMany();
    await db.user.deleteMany();
    const user = await db.user.create({
      data: { email: "lock-test@example.com", favoriteMovie: "Inception" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.$disconnect()));
  });

  it("lets exactly one of many concurrent requests acquire the lock", async () => {
    const lockedAt = new Date();
    const staleBefore = new Date(lockedAt.getTime() - LOCK_TIMEOUT_MS);

    // 5 clients x 4 attempts = 20 UPDATEs racing on the same row over separate connections.
    const attempts = clients.flatMap((client) =>
      Array.from({ length: 4 }, () =>
        createPrismaFactRepository(client).tryAcquireLock(userId, lockedAt, staleBefore)
      )
    );
    const results = await Promise.all(attempts);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("lets a request reclaim a lock that has expired", async () => {
    const now = new Date();
    await db.user.update({
      where: { id: userId },
      data: { factGenerationStartedAt: new Date(now.getTime() - LOCK_TIMEOUT_MS - 1_000) },
    });

    const repo = createPrismaFactRepository(db);
    const acquired = await repo.tryAcquireLock(userId, now, new Date(now.getTime() - LOCK_TIMEOUT_MS));

    expect(acquired).toBe(true);
  });

  it("does not let a request release a lock it no longer owns", async () => {
    const repo = createPrismaFactRepository(db);
    const ours = new Date("2026-01-01T12:00:00.000Z");
    const theirs = new Date("2026-01-01T12:00:45.000Z");
    await db.user.update({ where: { id: userId }, data: { factGenerationStartedAt: theirs } });

    await repo.releaseLock(userId, ours);

    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.factGenerationStartedAt?.getTime()).toBe(theirs.getTime());
  });

  it("generates only one fact when requests from several 'servers' race end to end", async () => {
    // Slow fake generator so the requests genuinely overlap while one is "calling OpenAI".
    const generate = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return "A fact about Inception";
    });

    const results = await Promise.all(
      clients.map((client) =>
        getFactForUser(userId, { repo: createPrismaFactRepository(client), generate })
      )
    );

    expect(generate).toHaveBeenCalledTimes(1);
    expect(await db.movieFact.count({ where: { userId } })).toBe(1);
    expect(results.filter((r) => r.status === "generated")).toHaveLength(1);
    expect(results.filter((r) => r.status === "generating")).toHaveLength(clients.length - 1);
  });
});
