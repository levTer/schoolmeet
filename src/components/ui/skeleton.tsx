import { cn } from "@/lib/utils";

/** Серый мерцающий блок-заглушка на время загрузки данных. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-xl bg-white/[0.06]", className)} />;
}

/** Каркас страницы с заголовком и сеткой карточек — для loading.tsx. */
export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div role="status" aria-label="Загрузка" className="mx-auto w-full max-w-7xl px-5 py-9 sm:px-8">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-6 h-10 w-72 max-w-full" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: cards }, (_, index) => (
          <Skeleton key={index} className="h-40 rounded-3xl" />
        ))}
      </div>
    </div>
  );
}
