/**
 * EduFlow · темы дизайн-системы «Telegram × Twitch Dark».
 *
 * Каждая тема задаёт ТОЛЬКО акцент, вторую краску палитры и цвет нативной
 * полосы (`--titlebar-color`), поэтому сетка, контраст и типографика
 * одинаковы на всех поверхностях: Web Desktop, Web Mobile, Android APK,
 * Windows .exe и macOS .dmg.
 *
 * Темы делятся на две группы:
 *  • «core» — базовая пятёрка дизайн-системы (graphite, indigo, emerald…);
 *  • «palette» — цветовые палитры из референсов (`palette` хранит точные
 *    названия и hex-коды красок, чтобы меню показывало их один в один).
 *
 * Список синхронизирован с `src/styles/design-tokens.css`:
 * id темы === значение атрибута `data-theme` на <html>.
 */

export const THEME_STORAGE_KEY = "sm-theme";
export const LEGACY_THEME_STORAGE_KEY = "schoolmeet-theme";
export const TEXT_SIZE_STORAGE_KEY = "sm-text-size";
export const DEFAULT_THEME = "graphite" as const;
export const DEFAULT_TEXT_SIZE = "normal" as const;

export interface ThemeSwatch {
  /** Подпись краски с референса («Малиново-красный»). */
  name: string;
  /** Точный hex краски с референса. */
  hex: string;
}

/** Группа темы: базовая пятёрка или палитра из референсов. */
export type ThemeGroup = "core" | "palette";

export interface ThemeOption {
  /** Значение `data-theme` и ключ локали в дизайн-токенах. */
  id: ThemeId;
  label: string;
  /** Короткое описание для меню внешнего вида. */
  description: string;
  /** Группа для меню внешнего вида. */
  group: ThemeGroup;
  /** Акцент темы (--accent-primary): только активные элементы. */
  accent: string;
  /** Вторая краска палитры (--accent-secondary): вторичные акценты, свечение. */
  secondary: string;
  /** Цвет текста/иконок на заливке акцентом (--accent-contrast). */
  onAccent: string;
  /** Фон страницы (--bg-primary) — цвет для meta theme-color. */
  background: string;
  /** Псевдоним `background` для JS-моста Android (`setStatusBarColor`). */
  bgColor: string;
  /** Цвет нативной полосы окна/статус-бара (--titlebar-color). */
  titlebar: string;
  /** Цвет символов системных кнопок окна (--titlebar-symbol). */
  symbol: string;
  /** Точные краски палитры: подписи и hex как на референсе. */
  palette: readonly ThemeSwatch[];
}

export const CORE_THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: "graphite",
    label: "Dark Graphite",
    description: "Глубокий графит Twitch",
    group: "core",
    accent: "#10B981",
    secondary: "#10B981",
    onAccent: "#FFFFFF",
    background: "#0B0F17",
    bgColor: "#0B0F17",
    titlebar: "#0B0F17",
    symbol: "#F9FAFB",
    palette: [
      { name: "Изумрудный акцент", hex: "#10B981" },
      { name: "Графитовый фон", hex: "#0B0F17" },
    ],
  },
  {
    id: "indigo",
    label: "Indigo Night",
    description: "Холодный индиго",
    group: "core",
    accent: "#6366F1",
    secondary: "#6366F1",
    onAccent: "#FFFFFF",
    background: "#0A0D1C",
    bgColor: "#0A0D1C",
    titlebar: "#080B18",
    symbol: "#F9FAFB",
    palette: [
      { name: "Индиго", hex: "#6366F1" },
      { name: "Ночной индиго", hex: "#0A0D1C" },
    ],
  },
  {
    id: "emerald",
    label: "Emerald Pro",
    description: "Насыщенный изумруд",
    group: "core",
    accent: "#34D399",
    secondary: "#34D399",
    onAccent: "#FFFFFF",
    background: "#08120F",
    bgColor: "#08120F",
    titlebar: "#06100C",
    symbol: "#F9FAFB",
    palette: [
      { name: "Изумруд", hex: "#34D399" },
      { name: "Тёмный изумруд", hex: "#08120F" },
    ],
  },
  {
    id: "violet",
    label: "Violet Glow",
    description: "Фиолетовый акцент",
    group: "core",
    accent: "#A855F7",
    secondary: "#A855F7",
    onAccent: "#FFFFFF",
    background: "#0D0A17",
    bgColor: "#0D0A17",
    titlebar: "#0A0813",
    symbol: "#F9FAFB",
    palette: [
      { name: "Фиолетовый", hex: "#A855F7" },
      { name: "Ночной фиолетовый", hex: "#0D0A17" },
    ],
  },
  {
    id: "slate",
    label: "Classic Slate",
    description: "Нейтральный графит",
    group: "core",
    accent: "#94A3B8",
    secondary: "#94A3B8",
    onAccent: "#FFFFFF",
    background: "#0F141B",
    bgColor: "#0F141B",
    titlebar: "#0C1117",
    symbol: "#F9FAFB",
    palette: [
      { name: "Сланец", hex: "#94A3B8" },
      { name: "Классический графит", hex: "#0F141B" },
    ],
  },
] as const;

/**
 * Цветовые палитры из референсов: каждая карточка — отдельная тема.
 *
 * В палитре хранятся ТОЧНЫЕ краски референса (подпись + hex). Тёмная краска
 * палитры становится фоном интерфейса, самая выразительная — акцентом,
 * третья и четвёртая — вторичными акцентами (`--accent-secondary`).
 */
export const PALETTE_THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: "plum-berry",
    label: "Сливово-малиновая",
    description: "Сливовый фон, малиновый акцент",
    group: "palette",
    accent: "#CA054D",
    secondary: "#A4D4B4",
    onAccent: "#FFFFFF",
    background: "#1A0D16",
    bgColor: "#1A0D16",
    titlebar: "#150A12",
    symbol: "#F9FAFB",
    palette: [
      { name: "Малиново-красный", hex: "#CA054D" },
      { name: "Тёмный сливовый", hex: "#3B1C32" },
      { name: "Мятно-зелёный", hex: "#A4D4B4" },
      { name: "Персиковый", hex: "#FFCF9C" },
    ],
  },
  {
    id: "mint-navy",
    label: "Мятно-синяя",
    description: "Тёмно-синий фон, мятная бирюза",
    group: "palette",
    accent: "#D81E5B",
    secondary: "#59C9A5",
    onAccent: "#FFFFFF",
    background: "#0B111C",
    bgColor: "#0B111C",
    titlebar: "#080E16",
    symbol: "#F9FAFB",
    palette: [
      { name: "Светлая мята", hex: "#B9E3C6" },
      { name: "Бирюзовый", hex: "#59C9A5" },
      { name: "Малиново-розовый", hex: "#D81E5B" },
      { name: "Тёмно синий", hex: "#23395B" },
    ],
  },
  {
    id: "moss-cyan",
    label: "Мшисто-циановая",
    description: "Мшистый фон, циановый акцент",
    group: "palette",
    accent: "#00E5FF",
    secondary: "#4F6F3A",
    onAccent: "#0B0F17",
    background: "#0D130A",
    bgColor: "#0D130A",
    titlebar: "#0B0F08",
    symbol: "#F9FAFB",
    palette: [
      { name: "Мшистый", hex: "#4F6F3A" },
      { name: "Циан", hex: "#00E5FF" },
    ],
  },
  {
    id: "forest-lime",
    label: "Лесная",
    description: "Лесной фон, сухой лайм и фиалка",
    group: "palette",
    accent: "#B8C98A",
    secondary: "#7650A8",
    onAccent: "#0B0F17",
    background: "#0C1210",
    bgColor: "#0C1210",
    titlebar: "#090F0C",
    symbol: "#F9FAFB",
    palette: [
      { name: "Сухой лайм", hex: "#B8C98A" },
      { name: "Лесной", hex: "#365447" },
      { name: "Пыльно фиолетовый", hex: "#7650A8" },
    ],
  },
  {
    id: "neon-mint",
    label: "Неоново-мятная",
    description: "Угольный фон, неоновая мята и розовый",
    group: "palette",
    accent: "#00F5D4",
    secondary: "#FF286B",
    onAccent: "#0B0F17",
    background: "#111111",
    bgColor: "#111111",
    titlebar: "#0D0D0D",
    symbol: "#F9FAFB",
    palette: [
      { name: "Неоновая мята", hex: "#00F5D4" },
      { name: "Ново розовый", hex: "#FF286B" },
      { name: "Тёмно серый", hex: "#171717" },
    ],
  },
  {
    id: "petrol-vintage",
    label: "Петрольная",
    description: "Петрольный фон, винтажный жёлтый",
    group: "palette",
    accent: "#F2C14E",
    secondary: "#F4EDE0",
    onAccent: "#0B0F17",
    background: "#071314",
    bgColor: "#071314",
    titlebar: "#060F10",
    symbol: "#F9FAFB",
    palette: [
      { name: "Винтажный жёлтый", hex: "#F2C14E" },
      { name: "Петрольный", hex: "#28666E" },
      { name: "Бумажный", hex: "#F4EDE0" },
    ],
  },
  {
    id: "navy-magenta",
    label: "Тёмно-синяя малиновая",
    description: "Тёмно-синий фон, малиновый акцент",
    group: "palette",
    accent: "#F72585",
    secondary: "#1B263B",
    onAccent: "#0B0F17",
    background: "#0C111B",
    bgColor: "#0C111B",
    titlebar: "#0A0E15",
    symbol: "#F9FAFB",
    palette: [
      { name: "Тёмно-синий", hex: "#1B263B" },
      { name: "Малиновый", hex: "#F72585" },
    ],
  },
  {
    id: "teal-orange",
    label: "Бирюзово-оранжевая",
    description: "Бирюзовый фон, оранжевый акцент",
    group: "palette",
    accent: "#F4A261",
    secondary: "#2A9D8F",
    onAccent: "#0B0F17",
    background: "#051412",
    bgColor: "#051412",
    titlebar: "#04100E",
    symbol: "#F9FAFB",
    palette: [
      { name: "Бирюзовый", hex: "#2A9D8F" },
      { name: "Оранжевый", hex: "#F4A261" },
    ],
  },
  {
    id: "toxic-lime",
    label: "Ядовито-жёлтая",
    description: "Тёмно-зелёный фон, ядовитый лайм",
    group: "palette",
    accent: "#E5FF00",
    secondary: "#123B2A",
    onAccent: "#0B0F17",
    background: "#06140E",
    bgColor: "#06140E",
    titlebar: "#05100B",
    symbol: "#F9FAFB",
    palette: [
      { name: "Тёмно-зелёный", hex: "#123B2A" },
      { name: "Ядовито-жёлтый", hex: "#E5FF00" },
    ],
  },
  {
    id: "indigo-ice",
    label: "Индиго-ледяная",
    description: "Тёмный индиго, ледяной голубой",
    group: "palette",
    accent: "#A5E7FF",
    secondary: "#19152F",
    onAccent: "#0B0F17",
    background: "#110F21",
    bgColor: "#110F21",
    titlebar: "#0E0C1A",
    symbol: "#F9FAFB",
    palette: [
      { name: "Тёмный индиго", hex: "#19152F" },
      { name: "Ледяной голубой", hex: "#A5E7FF" },
    ],
  },
  {
    id: "pine-ash",
    label: "Хвойно-пепельная",
    description: "Хвойный фон, пепельный акцент",
    group: "palette",
    accent: "#D9D9D9",
    secondary: "#1B4332",
    onAccent: "#0B0F17",
    background: "#08130E",
    bgColor: "#08130E",
    titlebar: "#060F0C",
    symbol: "#F9FAFB",
    palette: [
      { name: "Хвойный", hex: "#1B4332" },
      { name: "Пепельный", hex: "#D9D9D9" },
    ],
  },
  {
    id: "olive-cream",
    label: "Оливково-кремовая",
    description: "Оливковый фон, кремовый акцент",
    group: "palette",
    accent: "#FEFAE0",
    secondary: "#606C38",
    onAccent: "#0B0F17",
    background: "#101209",
    bgColor: "#101209",
    titlebar: "#0D0E07",
    symbol: "#F9FAFB",
    palette: [
      { name: "Оливковый", hex: "#606C38" },
      { name: "Кремовый", hex: "#FEFAE0" },
    ],
  },
  {
    id: "purple-sky",
    label: "Пурпурно-голубая",
    description: "Пурпурный фон, голубой акцент",
    group: "palette",
    accent: "#4CC9F0",
    secondary: "#7209B7",
    onAccent: "#0B0F17",
    background: "#1F0231",
    bgColor: "#1F0231",
    titlebar: "#1A0229",
    symbol: "#F9FAFB",
    palette: [
      { name: "Пурпурный", hex: "#7209B7" },
      { name: "Голубой", hex: "#4CC9F0" },
    ],
  },
  {
    id: "lilac-yellow",
    label: "Сиренево-жёлтая",
    description: "Сиреневый фон, жёлтый акцент",
    group: "palette",
    accent: "#FFBE0B",
    secondary: "#8338EC",
    onAccent: "#0B0F17",
    background: "#170A2A",
    bgColor: "#170A2A",
    titlebar: "#130822",
    symbol: "#F9FAFB",
    palette: [
      { name: "Сиреневый", hex: "#8338EC" },
      { name: "Жёлтый", hex: "#FFBE0B" },
    ],
  },
  {
    id: "lemon-charcoal",
    label: "Лимонно-угольная",
    description: "Угольный фон, лимонный акцент",
    group: "palette",
    accent: "#FFF44F",
    secondary: "#1C1C1E",
    onAccent: "#0B0F17",
    background: "#111112",
    bgColor: "#111112",
    titlebar: "#0D0D0E",
    symbol: "#F9FAFB",
    palette: [
      { name: "Лимонный", hex: "#FFF44F" },
      { name: "Угольный", hex: "#1C1C1E" },
    ],
  },
  {
    id: "azure-white",
    label: "Лазурно-белая",
    description: "Лазурный фон, белый акцент",
    group: "palette",
    accent: "#FFFFFF",
    secondary: "#00B4D8",
    onAccent: "#0B0F17",
    background: "#001418",
    bgColor: "#001418",
    titlebar: "#001013",
    symbol: "#F9FAFB",
    palette: [
      { name: "Лазурный", hex: "#00B4D8" },
      { name: "Белый", hex: "#FFFFFF" },
    ],
  },
] as const;

export const THEME_OPTIONS: readonly ThemeOption[] = [
  ...CORE_THEME_OPTIONS,
  ...PALETTE_THEME_OPTIONS,
];

/** Секции меню внешнего вида: базовая пятёрка и палитры с референсов. */
export const THEME_SECTIONS = [
  { id: "core", title: "Базовые темы", hint: "Дизайн-система" },
  { id: "palette", title: "Цветовые палитры", hint: "С референсов" },
] as const satisfies readonly { id: ThemeGroup; title: string; hint: string }[];

export type ThemeId =
  | "graphite"
  | "indigo"
  | "emerald"
  | "violet"
  | "slate"
  | "plum-berry"
  | "mint-navy"
  | "moss-cyan"
  | "forest-lime"
  | "neon-mint"
  | "petrol-vintage"
  | "navy-magenta"
  | "teal-orange"
  | "toxic-lime"
  | "indigo-ice"
  | "pine-ash"
  | "olive-cream"
  | "purple-sky"
  | "lilac-yellow"
  | "lemon-charcoal"
  | "azure-white";

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
