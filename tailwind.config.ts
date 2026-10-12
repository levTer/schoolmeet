import type { Config } from "tailwindcss";

const themeRgb = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

/**
 * Цветовые токены ссылаются на CSS variables, поэтому все использующие их
 * классы (bg-brand-500, text-accent-300, bg-ink-950 и т. д.) переключаются
 * одновременно при изменении data-theme на корневом элементе.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: themeRgb("--bg-primary-rgb"),
        /** Динамические поверхности интерфейса — глубокий фон и уровни карточек. */
        ink: {
          950: themeRgb("--bg-deep-rgb"),
          900: themeRgb("--bg-surface-rgb"),
          850: themeRgb("--bg-surface-raised-rgb"),
          800: themeRgb("--bg-panel-rgb"),
          700: themeRgb("--bg-panel-strong-rgb"),
        },
        /** Сохраняем существующие имена классов, но переводим бренд на акцент темы. */
        brand: {
          50: themeRgb("--accent-pale-rgb"),
          100: themeRgb("--accent-pale-rgb"),
          200: themeRgb("--accent-light-rgb"),
          300: themeRgb("--accent-light-rgb"),
          400: themeRgb("--accent-rgb"),
          500: themeRgb("--accent-rgb"),
          600: themeRgb("--accent-strong-rgb"),
          700: themeRgb("--accent-deep-rgb"),
          800: themeRgb("--accent-deep-rgb"),
          900: themeRgb("--accent-deep-rgb"),
          950: themeRgb("--accent-deep-rgb"),
        },
        /** Акцентные статусы, подсветки, таймер и индикатор говорящего. */
        accent: {
          100: themeRgb("--accent-pale-rgb"),
          200: themeRgb("--accent-light-rgb"),
          300: themeRgb("--accent-light-rgb"),
          400: themeRgb("--accent-rgb"),
          500: themeRgb("--accent-rgb"),
          600: themeRgb("--accent-strong-rgb"),
        },
        neon: {
          blue: themeRgb("--accent-rgb"),
          violet: themeRgb("--accent-light-rgb"),
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      backgroundImage: {
        "brand-gradient": "var(--brand-gradient)",
        "brand-gradient-soft": "var(--brand-gradient-soft)",
      },
      boxShadow: {
        glow: "var(--shadow-glow)",
        "glow-accent": "var(--shadow-glow-accent)",
        "neon-ring": "var(--shadow-neon-ring)",
        "inner-top": "inset 0 1px 0 0 rgba(255, 255, 255, 0.07)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(18px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-12px)" },
        },
        "gradient-pan": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(.9)", opacity: ".7" },
          "70%": { transform: "scale(1.35)", opacity: "0" },
          "100%": { transform: "scale(1.35)", opacity: "0" },
        },
        "spin-slow": {
          to: { transform: "rotate(360deg)" },
        },
        "neon-breathe": {
          "0%, 100%": {
            boxShadow: "0 0 0 2px rgb(var(--accent-rgb) / .85), 0 0 18px 2px rgb(var(--accent-rgb) / .35)",
          },
          "50%": {
            boxShadow: "0 0 0 2px rgb(var(--accent-rgb) / 1), 0 0 34px 6px rgb(var(--accent-rgb) / .6)",
          },
        },
        "pulse-glow": {
          "0%, 100%": {
            boxShadow: "0 0 0 0 rgb(var(--accent-rgb) / .5), 0 24px 70px -24px rgb(var(--accent-rgb) / .5)",
          },
          "50%": {
            boxShadow: "0 0 0 8px rgb(var(--accent-rgb) / 0), 0 24px 70px -12px rgb(var(--accent-rgb) / .8)",
          },
        },
        "page-enter": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up .7s cubic-bezier(.16,1,.3,1) both",
        "fade-in": "fade-in .8s ease-out both",
        float: "float 7s ease-in-out infinite",
        "gradient-pan": "gradient-pan 8s ease infinite",
        shimmer: "shimmer 2.4s infinite",
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(.24,.6,.35,1) infinite",
        "spin-slow": "spin-slow 26s linear infinite",
        "neon-breathe": "neon-breathe 1.6s ease-in-out infinite",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "page-enter": "page-enter 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
