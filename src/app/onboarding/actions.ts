"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { favoriteMovieSchema } from "@/lib/validation";

export type OnboardingState = { error: string | null };

export async function saveFavoriteMovie(
  _prevState: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const parsed = favoriteMovieSchema.safeParse(formData.get("movie") ?? "");
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Only set the movie if it hasn't been set yet (onboarding is first-time only).
  await prisma.user.updateMany({
    where: { id: session.user.id, favoriteMovie: null },
    data: { favoriteMovie: parsed.data },
  });

  redirect("/dashboard");
}