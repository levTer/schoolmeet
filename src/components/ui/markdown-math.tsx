import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

import { cn } from "@/lib/utils";

/**
 * Markdown с LaTeX для условий домашних заданий.
 * Формулы: `$…$` (в строке) и `$$…$$` (отдельным блоком) — рендерит KaTeX.
 * Сырой HTML не разрешён (нет rehype-raw), ссылки открываются в новой вкладке.
 */

const components = {
  h1: (props: ComponentPropsWithoutRef<"h1">) => <h2 className="text-lg font-semibold text-white" {...props} />,
  h2: (props: ComponentPropsWithoutRef<"h2">) => <h3 className="text-base font-semibold text-white" {...props} />,
  h3: (props: ComponentPropsWithoutRef<"h3">) => <h4 className="text-sm font-semibold text-slate-100" {...props} />,
  p: (props: ComponentPropsWithoutRef<"p">) => <p className="text-slate-200" {...props} />,
  ul: (props: ComponentPropsWithoutRef<"ul">) => <ul className="list-disc space-y-1 pl-5 text-slate-200" {...props} />,
  ol: (props: ComponentPropsWithoutRef<"ol">) => <ol className="list-decimal space-y-1 pl-5 text-slate-200" {...props} />,
  blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote className="rounded-r-xl border-l-2 border-brand-400 bg-brand-500/10 px-3 py-2 text-slate-200" {...props} />
  ),
  a: (props: ComponentPropsWithoutRef<"a">) => (
    <a className="text-accent-300 underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...props} />
  ),
  code: (props: ComponentPropsWithoutRef<"code">) => (
    <code className="rounded border border-white/10 bg-white/[0.06] px-1 py-0.5 font-mono text-[0.85em] text-accent-200" {...props} />
  ),
  pre: (props: ComponentPropsWithoutRef<"pre">) => (
    <pre className="overflow-x-auto rounded-xl border border-white/10 bg-ink-900/80 p-3 font-mono text-xs text-accent-200" {...props} />
  ),
  table: (props: ComponentPropsWithoutRef<"table">) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: (props: ComponentPropsWithoutRef<"th">) => <th className="border border-white/10 bg-white/[0.04] px-2 py-1 text-left" {...props} />,
  td: (props: ComponentPropsWithoutRef<"td">) => <td className="border border-white/10 px-2 py-1" {...props} />,
};

export function MarkdownMath({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("markdown-math space-y-3 text-sm leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
