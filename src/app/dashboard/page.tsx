import Image from "next/image";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, image: true, favoriteMovie: true },
  });
  if (!user) redirect("/");
  if (!user.favoriteMovie) redirect("/onboarding");

  // Graceful fallbacks when Google doesn't provide a name or photo.
  const displayName = user.name?.trim() || user.email || "there";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-8 p-8">
<header className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {user.image ? (
            <Image
              src={user.image}
              alt={`${displayName}'s profile photo`}
              width={56}
              height={56}
              className="shrink-0 rounded-full"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gray-300 text-xl font-semibold text-gray-800">
              {initial}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{displayName}</p>
            {user.email && <p className="truncate text-sm text-gray-500">{user.email}</p>}
          </div>
        </div>

        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="shrink-0 rounded-lg border border-gray-300 px-4 py-2 text-sm dark:border-gray-700"
          >
            Log out
          </button>
        </form>
      </header>

      <section className="rounded-xl border border-gray-200 p-6 dark:border-gray-800">
        <p className="text-sm text-gray-500">Your favorite movie</p>
        <p className="mt-1 text-2xl font-bold">{user.favoriteMovie}</p>
      </section>

      <section className="rounded-xl border border-gray-200 p-6 dark:border-gray-800">
        <p className="text-sm text-gray-500">Fun fact</p>
        <p className="mt-1 text-gray-400">Coming next…</p>
      </section>
    </main>
  );
}