"use client";

import { useActionState } from "react";
import { saveFavoriteMovie, type OnboardingState } from "./actions";

const initialState: OnboardingState = { error: null };

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(saveFavoriteMovie, initialState);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-3">
      <label htmlFor="movie" className="text-sm font-medium">
        What&apos;s your favorite movie?
      </label>
      <input
        id="movie"
        name="movie"
        type="text"
        maxLength={100}
        required
        placeholder="e.g. Inception"
        className="rounded-lg border border-gray-300 bg-transparent px-4 py-2 dark:border-gray-700"
      />
      {state.error && <p className="text-sm text-red-500">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-black px-6 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {pending ? "Saving..." : "Continue"}
      </button>
    </form>
  );
}