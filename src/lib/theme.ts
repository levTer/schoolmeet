/**
 * EduFlow · темы дизайн-системы «Telegram × Twitch Dark».
 *
 * Пять тем задают ТОЛЬКО акцент и цвет нативной полосы (`--titlebar-color`),
 * поэтому сетка, контраст и типографика одинаковы на всех пяти поверхностях:
 * Web Desktop, Web Mobile, Android APK, Windows .exe и macOS .dmg.
 *
 * Список синхронизирован с `src/styles/design-tokens.css`:
 * id темы === значение атрибута `data-theme` на <html>.
 */

export const THEME_STORAGE_KEY = "sm-theme";
export const LEGACY_THEME_STORAGE_KEY = "schoolmeet-theme";
export const TEXT_SIZE_STORAGE_KEY = "sm-text-size";
export const DEFAULT_THEME = "graphite" as const;
export const DEFAULT_TEXT_SIZE = "normal" as const;

export interface ThemeOption {
  /** Значение `data-theme` и ключ локали в дизайн-токенах. */
  id: ThemeId;
  label: string;
  /** Короткое описание для меню внешнего вида. */
  description: string;
  /** Акцент темы (--accent-primary): только активные элементы. */
  accent: string;
  /** Фон страницы (--bg-primary) — цвет для meta theme-color. */
  background: string;
  /** Псевдоним `background` для JS-моста Android (`setStatusBarColor`). */
  bgColor: string;
  /** Цвет нативной полосы окна/статус-бара (--titlebar-color). */
  titlebar: string;
  /** Цвет символов системных кнопок окна (--titlebar-symbol). */
  symbol: string;
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: "graphite",
    label: "Dark Graphite",
    description: "Глубокий графит Twitch",
    accent: "#10B981",
    background: "#0B0F17",
    bgColor: "#0B0F17",
    titlebar: "#0B0F17",
    symbol: "#F9FAFB",
  },
  {
    id: "indigo",
    label: "Indigo Night",
    description: "Холодный индиго",
    accent: "#6366F1",
    background: "#0A0D1C",
    bgColor: "#0A0D1C",
    titlebar: "#080B18",
    symbol: "#F9FAFB",
  },
  {
    id: "emerald",
    label: "Emerald Pro",
    description: "Насыщенный изумруд",
    accent: "#34D399",
    background: "#08120F",
    bgColor: "#08120F",
    titlebar: "#06100C",
    symbol: "#F9FAFB",
  },
  {
    id: "violet",
    label: "Violet Glow",
    description: "Фиолетовый акцент",
    accent: "#A855F7",
    background: "#0D0A17",
    bgColor: "#0D0A17",
    titlebar: "#0A0813",
    symbol: "#F9FAFB",
  },
  {
    id: "slate",
    label: "Classic Slate",
    description: "Нейтральный графит",
    accent: "#94A3B8",
    background: "#0F141B",
    bgColor: "#0F141B",
    titlebar: "#0C1117",
    symbol: "#F9FAFB",
  },
] as const;

export type ThemeId = "graphite" | "indigo" | "emerald" | "violet" | "slate";

/** Идентификаторы прошлой (неоновой) системы — хранятся у части пользователей. */
export const LEGACY_THEME_ALIASES: Readonly<Record<string, ThemeId>> = {
  emerald: "emerald",
  cyber: "violet",
  ocean: "indigo",
  mint: "graphite",
};

export const TEXT_SIZE_OPTIONS = [
  { id: "small", label: "Мелкий" },
  { id: "normal", label: "Стандарт" },
  { id: "large", label: "Крупный" },
] as const;

export type TextSize = (typeof TEXT_SIZE_OPTIONS)[number]["id"];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_OPTIONS.some((theme) => theme.id === value);
}

/**
 * Приводит сохранённое значение (включая старые id) к актуальной теме.
 * Возвращает `null`, если значение не распознано.
 */
export function normalizeThemeId(value: unknown): ThemeId | null {
  if (isThemeId(value)) return value;
  if (typeof value === "string" && LEGACY_THEME_ALIASES[value]) {
    return LEGACY_THEME_ALIASES[value];
  }
  return null;
}

export function isTextSize(value: unknown): value is TextSize {
  return typeof value === "string" && TEXT_SIZE_OPTIONS.some((size) => size.id === value);
}

export function getThemeOption(themeId: ThemeId): ThemeOption {
  return THEME_OPTIONS.find((theme) => theme.id === themeId) ?? THEME_OPTIONS[0];
}

/**
 * Краткая карта тем для bootstrap-скрипта в <head>:
 * применяется до первой отрисовки, чтобы не было вспышки чужого акцента.
 */
export function themeBootstrapMap(): Record<string, string> {
  return Object.fromEntries(THEME_OPTIONS.map(({ id, background }) => [id, background]));
}
