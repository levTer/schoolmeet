import { Check, ScanLine, Sparkles, Wand2 } from "lucide-react";

/** Секция «ИИ-Доска» — раскрывает мультимодальный разбор рукописного ввода. */
export function AiBoardSection() {
  return (
    <section id="ai-board" className="relative scroll-mt-28 overflow-hidden py-24 sm:py-28">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[30rem] w-[60rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-600/10 blur-[120px]" />
      </div>

      <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 sm:px-8 lg:grid-cols-2">
        {/* Текстовая колонка */}
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1 text-xs font-medium uppercase tracking-widest text-slate-400">
            <Wand2 className="h-3.5 w-3.5 text-accent-300" />
            ИИ-Доска
          </span>

          <h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">
            Доска, которая <span className="text-gradient-brand">понимает</span>, что на ней написано
          </h2>

          <p className="mt-4 text-base leading-relaxed text-slate-400">
            Учитель рисует как обычно — мелком или стилусом. Каждые несколько секунд кадр уходит в
            GPT-4o Vision, ассистент распознаёт формулы, условия и графики и возвращает разбор прямо
            в урок: решение, пояснение и готовый конспект.
          </p>

          <ol className="mt-8 space-y-4">
            {[
              {
                icon: ScanLine,
                title: "Захват кадра доски",
                text: "Fabric.js сериализует полотно и отправляет его в ИИ-модуль.",
              },
              {
                icon: Sparkles,
                title: "Разбор GPT-4o Vision",
                text: "Модель читает рукописный ввод: уравнения, неравенства, геометрические чертежи.",
              },
              {
                icon: Check,
                title: "Ответ в уроке",
                text: "Решение появляется на доске, в чате и в конспекте ученика.",
              },
            ].map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="relative mt-0.5 inline-flex h-10 w-10 flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500/30 to-accent-500/10 text-white ring-1 ring-white/15">
                  <step.icon className="h-4 w-4" />
                  <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-[10px] font-semibold text-brand-200 ring-1 ring-white/10">
                    {index + 1}
                  </span>
                </span>
                <span>
                  <span className="block text-sm font-semibold text-white">{step.title}</span>
                  <span className="mt-1 block text-sm text-slate-400">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* Визуал */}
        <div className="relative">
          <div
            aria-hidden
            className="absolute -inset-6 rounded-[2.5rem] bg-brand-gradient opacity-15 blur-3xl"
          />

          <div className="ring-gradient relative overflow-hidden rounded-3xl border border-white/10 bg-ink-900/80 p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Разбор решения</p>
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-300">
                распознано за 1,2 с
              </span>
            </div>

            {/* «Рукописный» ввод */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-ink-950/70 p-4">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">С доски</p>
              <p className="mt-2 font-mono text-lg text-white">2x + 3 = 11</p>
              <svg viewBox="0 0 260 40" className="mt-1 h-8 w-full" aria-hidden>
                <path
                  d="M4 28 C 40 8, 70 34, 104 20 S 168 6, 200 26 c 18 11, 36 -4, 56 6"
                  fill="none"
                  stroke="#94a3b8"
                  strokeOpacity="0.5"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            {/* Ответ ИИ */}
            <div className="mt-3 space-y-2 rounded-2xl border border-brand-400/20 bg-gradient-to-br from-brand-500/10 to-accent-500/5 p-4">
              <p className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-brand-200">
                <Sparkles className="h-3.5 w-3.5" />
                Ответ ассистента
              </p>
              <p className="font-mono text-sm text-slate-200">2x = 11 − 3</p>
              <p className="font-mono text-sm text-slate-200">2x = 8 → x = 4</p>
              <p className="text-xs text-slate-400">
                Проверка: 2 · 4 + 3 = 11 ✓ — верно, можно показать классу пошагово.
              </p>
            </div>

            <div className="mt-3 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-slate-400">
              <span>Отправлено: чат · конспект · ДЗ</span>
              <span className="text-brand-200">GPT-4o Vision</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
