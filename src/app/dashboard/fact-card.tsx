import { prisma } from "@/lib/prisma";
import { createPrismaFactRepository } from "@/lib/fact-repository";
import { generateFactWithOpenAI } from "@/lib/openai";
import { getFactForUser } from "@/lib/facts";

export async function FactCard({ userId }: { userId: string }) {
  const result = await getFactForUser(userId, {
    repo: createPrismaFactRepository(prisma),
    generate: generateFactWithOpenAI,
  });

  switch (result.status) {
    case "fresh":
    case "generated":
      return <p className="mt-1 text-lg">{result.fact}</p>;
    case "stale":
      return (
        <>
          <p className="mt-1 text-lg">{result.fact}</p>
          <p className="mt-2 text-xs text-gray-500">
            Showing your most recent fact. A new one will be available shortly.
          </p>
        </>
      );
    case "generating":
      return (
        <p className="mt-1 text-gray-400">
          Your fun fact is being generated. Refresh in a few seconds.
        </p>
      );
    case "unavailable":
      return <p className="mt-1 text-gray-400">{result.message}</p>;
  }
}