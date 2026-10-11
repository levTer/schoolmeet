import { randomBytes } from "node:crypto";

/**
 * Короткий читаемый код урока из названия:
 *   «Математика 101 класс» → `matematika-101-klass`
 *   «Math 101 Class»       → `math-101-class`
 *
 * Код попадает в URL (`/meeting/<код>`) и в поиск по БД, поэтому он всегда
 * в нижнем регистре, только латиница, цифры и дефисы.
 */

const TRANSLIT: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya", і: "i", ї: "yi", є: "ye", ґ: "g",
};

const MAX_BASE_LENGTH = 32;
const SUFFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Превращает произвольное название в slug (без пустых и лишних дефисов). */
export function slugifyTitle(title: string): string {
  const transliterated = Array.from(title.trim().toLowerCase())
    .map((char) => TRANSLIT[char] ?? char)
    .join("");

  const slug = transliterated
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/, "");

  return slug || "lesson";
}

/** Короткий случайный суффикс (криптостойкий), например `k7qz`. */
export function randomCodeSuffix(length = 4): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length]).join("");
}

/**
 * Кандидат кода для попытки `attempt`: сначала «чистый» slug, при коллизии —
 * slug с суффиксом. Вызывающий код проверяет уникальность в БД.
 */
export function buildLessonCodeCandidate(title: string, attempt: number): string {
  const base = slugifyTitle(title);
  return attempt === 0 ? base : `${base}-${randomCodeSuffix()}`;
}
