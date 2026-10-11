"use client";

/**
 * Лёгкий Markdown-рендер для ответов ИИ-помощника.
 *
 * Поддерживает то, что есть в ответах MockAIProvider: заголовки, списки,
 * цитаты, блоки кода, `инлайн-код`, **жирный**, *курсив* и горизонтальные
 * линии. Рендер собирается обычными React-элементами — `dangerouslySetInnerHTML`
 * не используется, поэтому разметка из ответа не может выполнить скрипт.
 */

import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface MarkdownProps {
  /** Markdown-текст. */
  text: string;
  className?: string;
}

/** Экранировать ничего не нужно — текст попадает в React-children как есть. */
export function Markdown({ text, className }: MarkdownProps) {
  const blocks = parseBlocks(text);
  return <div className={cn("space-y-3 text-sm leading-relaxed", className)}>{blocks}</div>;
}

/* -------------------------------------------------------------------------- */
/* Парсер                                                                    */
/* -------------------------------------------------------------------------- */

function parseBlocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];

    // Пустые строки пропускаем.
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    // Блок кода ``` … ```
    if (line.trimStart().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-xl border border-white/10 bg-ink-900/80 p-3 font-mono text-xs text-accent-200"
        >
          {language ? (
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">{language}</span>
          ) : null}
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Горизонтальная линия.
    if (/^---+\s*$/.test(line.trim())) {
      blocks.push(<hr key={key++} className="border-white/10" />);
      index += 1;
      continue;
    }

    // Заголовки.
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2]);
      const classes = [
        "font-semibold text-white",
        level === 1 ? "text-base" : "",
        level === 2 ? "text-sm" : "",
        level >= 3 ? "text-sm text-slate-200" : "",
      ].join(" ");
      blocks.push(
        <p key={key++} className={classes}>
          {content}
        </p>,
      );
      index += 1;
      continue;
    }

    // Цитата.
    if (line.trimStart().startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].trimStart().startsWith(">")) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="rounded-r-xl border-l-2 border-brand-400 bg-brand-500/10 px-3 py-2 text-slate-200"
        >
          {renderInline(quote.join(" "))}
        </blockquote>,
      );
      continue;
    }

    // Маркированный список.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-1 pl-5 text-slate-200">
          {items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Нумерованный список.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={key++} className="list-decimal space-y-1 pl-5 text-slate-200">
          {items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Обычный абзац (собираем подряд идущие строки).
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !lines[index].trimStart().startsWith("```") &&
      !lines[index].trimStart().startsWith("#") &&
      !lines[index].trimStart().startsWith(">") &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !/^---+\s*$/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={key++} className="text-slate-200">
        {renderInline(paragraph.join(" "))}
      </p>,
    );
  }

  return blocks;
}

/** Инлайн-разметка: `код`, **жирный**, *курсив*. */
function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];

    if (token.startsWith("**")) {
      parts.push(
        <strong key={key++} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      parts.push(
        <code
          key={key++}
          className="rounded border border-white/10 bg-white/[0.06] px-1 py-0.5 font-mono text-[0.85em] text-accent-200"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(
        <em key={key++} className="italic text-slate-300">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = match.index + token.length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}
