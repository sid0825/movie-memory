import OpenAI from "openai";

/** Anything that can turn a movie title into a fun fact. Tests pass a fake. */
export type FactGenerator = (movie: string) => Promise<string>;

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export const generateFactWithOpenAI: FactGenerator = async (movie) => {
  // Created per call so a missing key fails this request, not the whole app.
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 10_000, // fail fast instead of hanging the dashboard
    maxRetries: 1,
  });

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You share short, accurate, fun trivia about movies. Reply with one or two sentences, no preamble. If you don't recognize the movie, say so briefly and share a fun general filmmaking fact instead.",
      },
      { role: "user", content: `Tell me a fun fact about the movie "${movie}".` },
    ],
    max_completion_tokens: 120,
  });

  const fact = response.choices[0]?.message?.content?.trim();
  if (!fact) throw new Error("OpenAI returned an empty response");
  return fact;
};