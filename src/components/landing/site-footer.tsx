import Link from "next/link";
import { GitBranch, Mail, MessageCircle, Send, ShieldCheck } from "lucide-react";

import { Logo } from "./logo";

const COLUMNS = [
  {
    title: "Продукт",
    links: [
      { label: "Возможности", href: "/#features" },
      { label: "Расписание", href: "/#schedule" },
      { label: "ИИ-Доска", href: "/#ai-board" },
      { label: "Безопасность", href: "/#features" },
    ],
  },
  {
    title: "Платформа",
    links: [
      { label: "Войти", href: "/login" },
      { label: "Регистрация", href: "/auth/register" },
      { label: "Для школ", href: "/#schedule" },
      { label: "Статус сервисов", href: "/#features" },
    ],
  },
  {
    title: "Поддержка",
    links: [
      { label: "Документация", href: "/#features" },
      { label: "Вопросы и ответы", href: "/#features" },
      { label: "Контакты", href: "mailto:support@eduflow.ai" },
      { label: "Политика конфиденциальности", href: "/#features" },
    ],
  },
] as const;

const SOCIALS = [
  { icon: Send, label: "Telegram", href: "https://t.me" },
  { icon: MessageCircle, label: "Сообщество", href: "/#features" },
  { icon: GitBranch, label: "GitHub", href: "https://github.com/levTer/schoolmeet" },
  { icon: Mail, label: "Почта", href: "mailto:support@eduflow.ai" },
] as const;

export function SiteFooter({ schoolName }: { schoolName?: string | null }) {
  const brandName = schoolName || "EduFlow";

  return (
    <footer
      className="relative border-t border-white/10 bg-ink-950/60"
      aria-label={`${brandName} — информация о платформе`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 h-24 bg-gradient-to-t from-brand-600/5 to-transparent"
      />

      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          {/* Бренд */}
          <div>
            <Logo schoolName={schoolName} />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-400">
              Платная платформа видеоуроков для школ: HD-звонки, ИИ-доска, расписание и защищённый
              чат в одном окне.
            </p>

            <div className="mt-5 flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="h-4 w-4 text-brand-300" />
              Шифрование AES-256 · ФЗ-152
            </div>
          </div>

          {/* Ссылки */}
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="text-sm font-semibold text-white">{column.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-slate-400 transition hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Нижняя строка */}
        <div className="mt-12 flex flex-col items-center justify-between gap-5 border-t border-white/10 pt-7 sm:flex-row">
          <p className="text-xs text-slate-500">
            © 2026 EduFlow. Все права защищены.
          </p>

          <div className="flex items-center gap-2">
            {SOCIALS.map((social) => (
              <Link
                key={social.label}
                href={social.href}
                aria-label={social.label}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 transition hover:border-white/20 hover:text-white"
              >
                <social.icon className="h-4 w-4" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
