/**
 * Динамическое приветствие в зависимости от времени суток (по времени школы).
 */

import { SCHOOL_TIMEZONE } from "@/lib/schedule-rules";

interface GreetingResult {
  /** Текст приветствия: "Доброе утро", "Добрый день", "Добрый вечер", "Доброй ночи". */
  greeting: string;
  /** Эмодзи времени суток. */
  emoji: string;
  /** Иконка-описание периода. */
  period: string;
}

/** Определяет время суток по часам в часовом поясе школы. */
export function getGreeting(date: Date = new Date(), timeZone: string = SCHOOL_TIMEZONE): GreetingResult {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "12");

  if (hour >= 5 && hour < 12) {
    return { greeting: "Доброе утро", emoji: "🌅", period: "утро" };
  }
  if (hour >= 12 && hour < 17) {
    return { greeting: "Добрый день", emoji: "☀️", period: "день" };
  }
  if (hour >= 17 && hour < 22) {
    return { greeting: "Добрый вечер", emoji: "🌆", period: "вечер" };
  }
  return { greeting: "Доброй ночи", emoji: "🌙", period: "ночь" };
}
