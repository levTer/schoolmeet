import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Умное объединение Tailwind-классов (последний `px-*`/`bg-*` побеждает). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Генерирует код комнаты вида `ABC-1234` (без похожих символов 0/O, 1/I). */
export function generateMeetingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";

  const pick = (source: string, length: number) =>
    Array.from({ length }, () => source[Math.floor(Math.random() * source.length)]).join("");

  return `${pick(alphabet, 3)}-${pick(digits, 4)}`;
}

/** Инициалы пользователя для аватара-заглушки: «Анна Иванова» → «АИ». */
export function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Форматирует "HH:mm" из Date. */
export function formatTime(date: Date | string): string {
  const value = typeof date === "string" ? new Date(date) : date;
  return value.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
