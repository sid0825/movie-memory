import { describe, it, expect, vi } from "vitest";
import { getFactForUser, CACHE_WINDOW_MS } from "./facts";
import { createInMemoryFactRepository } from "./test-utils/in-memory-fact-repository";

const T0 = new Date("2026-01-01T12:00:00Z");
const at = (msAfterT0: number) => new Date(T0.getTime() + msAfterT0);

function setup() {
  const { repo, facts, favorites } = createInMemoryFactRepository({
    alice: "Inception",
    bob: "Inception",
  });
  const generate = vi.fn(async (movie: string) => `Fun fact about ${movie}`);
  return { repo, facts, favorites, generate };
}

describe("60-second cache window", () => {
  it("generates and stores a fact when none exists", async () => {
    const { repo, facts, generate } = setup();

    const result = await getFactForUser("alice", { repo, generate, now: () => T0 });

    expect(result.status).toBe("generated");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(facts).toHaveLength(1);
  });

  it("reuses a fact that is less than 60 seconds old", async () => {
    const { repo, generate } = setup();
    await getFactForUser("alice", { repo, generate, now: () => T0 });

    const result = await getFactForUser("alice", { repo, generate, now: () => at(59_000) });

    expect(result.status).toBe("fresh");
    expect(generate).toHaveBeenCalledTimes(1); // no second OpenAI call
  });

  it("generates a new fact once the cached one is 60 seconds old", async () => {
    const { repo, facts, generate } = setup();
    await getFactForUser("alice", { repo, generate, now: () => T0 });

    const result = await getFactForUser("alice", { repo, generate, now: () => at(CACHE_WINDOW_MS) });

    expect(result.status).toBe("generated");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(facts).toHaveLength(2); // new fact stored, old one kept
  });

  it("does not reuse a fresh fact for a different movie", async () => {
    const { repo, favorites, generate } = setup();
    await getFactForUser("alice", { repo, generate, now: () => T0 });

    favorites.set("alice", "Clayface");
    const result = await getFactForUser("alice", { repo, generate, now: () => at(5_000) });

    expect(result.status).toBe("generated");
    expect(generate).toHaveBeenLastCalledWith("Clayface");
  });
});

describe("authorization", () => {
  it("never returns another user's fact, even a fresh one for the same movie", async () => {
    const { repo, generate } = setup();
    generate.mockResolvedValueOnce("Alice's fact").mockResolvedValueOnce("Bob's fact");

    await getFactForUser("alice", { repo, generate, now: () => T0 });
    const bobResult = await getFactForUser("bob", { repo, generate, now: () => at(1_000) });

    expect(bobResult.status).toBe("generated");
    expect(bobResult).toMatchObject({ fact: "Bob's fact" });
    expect(bobResult).not.toMatchObject({ fact: "Alice's fact" });
  });
});

describe("burst protection", () => {
  it("generates only once when several requests arrive at the same time", async () => {
    const { repo, facts, generate } = setup();
    generate.mockImplementation(
      (movie) => new Promise((resolve) => setTimeout(() => resolve(`Slow fact about ${movie}`), 20))
    );

    const results = await Promise.all(
      [1, 2, 3].map(() => getFactForUser("alice", { repo, generate, now: () => T0 }))
    );

    expect(generate).toHaveBeenCalledTimes(1);
    expect(facts).toHaveLength(1);
    expect(results.map((r) => r.status).sort()).toEqual(["generated", "generating", "generating"]);
  });
});

describe("failure handling", () => {
  it("falls back to the most recent fact when generation fails", async () => {
    const { repo, generate } = setup();
    await getFactForUser("alice", { repo, generate, now: () => T0 });
    generate.mockRejectedValueOnce(new Error("OpenAI timeout"));

    const result = await getFactForUser("alice", { repo, generate, now: () => at(61_000) });

    expect(result).toMatchObject({ status: "stale", fact: "Fun fact about Inception" });
  });

  it("returns a friendly error when there is nothing to fall back on", async () => {
    const { repo, generate } = setup();
    generate.mockRejectedValueOnce(new Error("OpenAI down"));

    const result = await getFactForUser("alice", { repo, generate, now: () => T0 });

    expect(result.status).toBe("unavailable");
    expect(result).not.toMatchObject({ message: expect.stringContaining("OpenAI down") });
  });

  it("releases the lock after a failure so the next request can retry", async () => {
    const { repo, generate } = setup();
    generate.mockRejectedValueOnce(new Error("OpenAI down"));
    await getFactForUser("alice", { repo, generate, now: () => T0 });

    const retry = await getFactForUser("alice", { repo, generate, now: () => at(1_000) });

    expect(retry.status).toBe("generated");
  });
});