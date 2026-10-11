import type { Config } from "tailwindcss";

/**
 * Палитра SchoolMeet, этап 3: почти чёрный графит, ярко-фиолетовый бренд и
 * неоново-синий акцент. Токены используются во всём сайте (лендинг, кабинет,
 * формы, видеокомната), поэтому менять цвета стоит только здесь.
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
        /** Графитовая подложка: от почти чёрного (950) до светлого графита (700). */
        ink: {
          950: "#06070b",
          900: "#0a0c12",
          850: "#0e1119",
          800: "#151923",
          700: "#1d2230",
        },
        /** Ярко-фиолетовый бренд: кнопки, активные состояния, свечение. */
        brand: {
          50: "#faf5ff",
          100: "#f3e8ff",
          200: "#e9d5ff",
          300: "#d8b4fe",
          400: "#c084fc",
          500: "#a855f7",
          600: "#9333ea",
          700: "#7e22ce",
          800: "#6b21a8",
          900: "#581c87",
          950: "#3b0764",
        },
        /** Неоново-синий акцент: подсветка, таймер, «говорит сейчас». */
        accent: {
          300: "#8cf3ff",
          400: "#00d9ff",
          500: "#00b4ff",
          600: "#0091e6",
        },
        neon: {
          blue: "#00d9ff",
          violet: "#b44dff",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #b44dff 0%, #8b3dff 35%, #3b82f6 70%, #00d9ff 100%)",
        "brand-gradient-soft":
          "linear-gradient(135deg, rgba(168,85,247,.20) 0%, rgba(59,130,246,.12) 50%, rgba(0,217,255,.16) 100%)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(168, 85, 247, 0.18), 0 24px 70px -24px rgba(168, 85, 247, 0.75)",
        "glow-accent": "0 0 0 1px rgba(0, 217, 255, 0.25), 0 24px 70px -26px rgba(0, 217, 255, 0.7)",
        "neon-ring": "0 0 0 2px rgba(0, 217, 255, 0.85), 0 0 26px 4px rgba(0, 217, 255, 0.45)",
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
          "0%, 100%": { boxShadow: "0 0 0 2px rgba(0,217,255,.85), 0 0 18px 2px rgba(0,217,255,.35)" },
          "50%": { boxShadow: "0 0 0 2px rgba(0,217,255,1), 0 0 34px 6px rgba(0,217,255,.6)" },
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
      },
    },
  },
  plugins: [],
};

export default config;
