import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * Скелетон кабинета: показывается, пока страница ждёт ответ базы.
 *
 * При задержке Neon `/dashboard` может отвечать несколько секунд — вместо
 * пустого экрана пользователь сразу видит каркас страницы.
 */
export default function DashboardLoading() {
  return <PageSkeleton cards={3} />;
}
