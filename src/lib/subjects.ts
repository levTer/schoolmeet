/**
 * Каталог предметов школьной программы Лицея Сингулярити.
 *
 * Модуль чистый (без Prisma, БД и Node API): его импортируют и сид
 * (`prisma/seed.ts`), и серверный слой расписания (`src/lib/schedule.ts`),
 * и клиентские компоненты (`LessonModal`) — поэтому список предметов
 * гарантированно один и тот же во всех слоях.
 *
 * `DEFAULT_SUBJECTS` — эталонный набор: из него создаётся демо-база
 * (`npm run db:seed`) и он же автоматически наполняет пустую таблицу
 * `subjects` при первом открытии расписания (см. `ensureDefaultSubjects`),
 * чтобы в модалке «Новый урок» всегда был выбор предмета.
 */

export interface SubjectSeed {
  /** Название предмета, например «Математика». Уникально в БД. */
  name: string;
  /** Фирменный цвет в HEX — используется в сетке карточек предмета. */
  color: string;
  /** Эмодзи предмета для компактных карточек и селектов. */
  emoji: string;
}

/** Эталонный список предметов (10 позиций школьной программы). */
export const DEFAULT_SUBJECTS: readonly SubjectSeed[] = [
  { name: "Математика", color: "#a855f7", emoji: "🧮" },
  { name: "Физика", color: "#00b4ff", emoji: "⚡" },
  { name: "Химия", color: "#22c55e", emoji: "🧪" },
  { name: "Литература", color: "#f97316", emoji: "📖" },
  { name: "История", color: "#eab308", emoji: "📜" },
  { name: "Биология", color: "#10b981", emoji: "🌿" },
  { name: "Информатика", color: "#06b6d4", emoji: "💻" },
  { name: "Английский", color: "#3b82f6", emoji: "🇬🇧" },
  { name: "Русский", color: "#ec4899", emoji: "📝" },
  { name: "Физкультура", color: "#ef4444", emoji: "🏃" },
];

/**
 * Полупрозрачный оттенок фирменного цвета предмета для фона карточки.
 * Принимает `#rgb`/`#rrggbb`; на некорректном значении возвращает исходный
 * цвет, чтобы UI не ломался из-за данных из БД.
 */
export function subjectTint(color: string, alpha = 0.18): string {
  const hex = color.trim().replace(/^#/, "");
  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : hex;

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return color;

  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
