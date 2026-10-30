/**
 * ESLint 10 (flat config).
 *
 * В Next.js 16 команда `next lint` удалена, поэтому ESLint запускается
 * напрямую (`npm run lint` → `eslint .`) и входит в CI отдельным шагом:
 * `next build` больше не линтует, без этого шага ошибки прошли бы молча.
 *
 * Наборы правил — официальные `eslint-config-next` (App Router + TypeScript).
 * Отличия от дефолта осознанные и перечислены ниже:
 *  - `electron-app/**` и `desktop/**` — CommonJS-обвязка Electron (`require`,
 *    `module.exports`), она не входит в бандл Next.js и не транспилируется
 *    TypeScript;
 *  - правила React Compiler (`react-hooks/refs`, `/immutability`, `/purity`,
 *    `/set-state-in-effect`) выключены: доска на Fabric.js и WebRTC-хуки
 *    намеренно держат изменяемые объекты в ref и синхронизируют их в эффектах.
 *    Это не React-состояние, и правила дают на них ложные срабатывания.
 *    Включать их имеет смысл вместе с переходом на React Compiler;
 *  - `no-explicit-any` отключён в тестах: моки Prisma/NextAuth повторяют
 *    внешние типы, точное описание которых в тестовом файле было бы
 *    копированием сгенерированного клиента.
 */
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  {
    // Сборки, зависимости и артефакты упаковщиков не линтуем.
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "dist/**",
      "build/**",
      "public/**",
      "coverage/**",
      "electron-app/**",
      "desktop/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    files: ["**/*.{ts,tsx,mts}"],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["scripts/**/*.test.{ts,mts}", "scripts/**/*.test.{tsx,mts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default config;
