import { PageSkeleton } from "@/components/ui/skeleton";

/** Скелетон админ-панели: пока сервер собирает метрики и списки. */
export default function AdminLoading() {
  return <PageSkeleton cards={6} />;
}
