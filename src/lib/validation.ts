import { z } from "zod";

export const favoriteMovieSchema = z
  .string()
  .trim()
  .min(1, "Please enter a movie title.")
  .max(100, "Movie title must be 100 characters or fewer.");