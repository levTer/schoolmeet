/**
 * Принудительное пересоздание мастер-аккаунта администратора.
 *
 * Зачем отдельный скрипт, а не сид: `prisma/seed.ts` создаёт демо-админа
 * `admin@schoolmeet.dev` через upsert и не трогает этот аккаунт. Здесь нужен
 * именно ЖЁСТКИЙ сценарий «удалить → создать заново», чтобы гарантированно
 * сбросить пароль, роль, бан и привязку к школе, что бы ни лежало в БД раньше.
 *
 * Что делает:
 *   1. Находит школу по коду `Sinlycem26` (без школы аккаунт НЕ создаётся:
 *      админ без schoolId не видит данные своей школы).
 *   2. Удаляет пользователя `admin@sinlycem.ru`, если он есть. Связанные
 *      записи (встречи, расписание, ДЗ, сообщения…) удалятся каскадно по
 *      `onDelete: Cascade` из схемы, AuditLog — `SetNull`.
 *   3. Создаёт пользователя заново: роль ADMIN, школа Sinlycem26, не забанен,
 *      пароль — bcrypt-хеш тем же способом, что и в остальном проекте
 *      (`hashPassword` из `src/lib/password.ts`, bcryptjs, 10 раундов).
 *   4. Проверяет результат: перечитывает запись и сверяет пароль через
 *      `verifyPassword` — ровно так, как это делает вход в `src/lib/auth.ts`.
 *
 * Запуск:  npx tsx scripts/fix-master-admin.ts
 * Требуется DATABASE_URL (та же БД, что у запущенного приложения).
 */
import { PrismaClient } from "@prisma/client";

import { hashPassword, verifyPassword } from "../src/lib/password";

const prisma = new PrismaClient();

const SCHOOL_CODE = "Sinlycem26";
const ADMIN_EMAIL = "admin@sinlycem.ru";
const ADMIN_PASSWORD = "lev_Terentiev2012!";
const ADMIN_NAME = "Лев Терентьев (Админ)";

async function main(): Promise<void> {
  // 1. Школа: сначала точное совпадение кода, затем — без учёта регистра
  //    (коды в CONFIGURED_SCHOOLS хранятся «как написаны», см. school-config.ts).
  const school =
    (await prisma.school.findUnique({
      where: { code: SCHOOL_CODE },
      select: { id: true, name: true, code: true },
    })) ??
    (await prisma.school.findFirst({
      where: { code: { equals: SCHOOL_CODE, mode: "insensitive" } },
      select: { id: true, name: true, code: true },
    }));

  if (!school) {
    throw new Error(
      `Школа с кодом "${SCHOOL_CODE}" не найдена в БД. ` +
        "Сначала создайте школы (npm run db:seed или запуск приложения — provisionConfiguredSchools), " +
        "затем повторите этот скрипт. Аккаунт без школы не создаю.",
    );
  }
  console.log(`✓ Школа найдена: ${school.name} (code=${school.code}, id=${school.id})`);

  // 2–3. Удаление + создание — одной транзакцией: между ними не должно быть
  // окна, когда аккаунта нет вообще, и полуприменённого состояния при сбое.
  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { email: ADMIN_EMAIL },
      select: { id: true, role: true, schoolId: true },
    });

    if (existing) {
      await tx.user.delete({ where: { email: ADMIN_EMAIL } });
      console.log(
        `• Старый аккаунт удалён (id=${existing.id}, была роль ${existing.role}, schoolId=${existing.schoolId ?? "null"})`,
      );
    } else {
      console.log("• Старого аккаунта не было — создаю с нуля");
    }

    return tx.user.create({
      data: {
        email: ADMIN_EMAIL,
        password: passwordHash,
        name: ADMIN_NAME,
        role: "ADMIN",
        schoolId: school.id,
        // Явно, а не «как получится»: админ не ученик и не должен быть забанен.
        grade: null,
        classId: null,
        isBanned: false,
      },
      select: { id: true, email: true, name: true, role: true, schoolId: true, isBanned: true, createdAt: true },
    });
  });

  console.log(`✓ Создан новый пользователь: ${created.email} (id=${created.id})`);

  // 4. Верификация ровно по пути входа: запись перечитывается из БД,
  //    пароль сверяется bcrypt-ом, роль/школа/бан проверяются по факту.
  const saved = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
    select: { email: true, name: true, role: true, schoolId: true, isBanned: true, password: true },
  });
  if (!saved) throw new Error("Аккаунт не найден сразу после создания — что-то не так с БД");

  const passwordOk = await verifyPassword(ADMIN_PASSWORD, saved.password);
  const checks: ReadonlyArray<[string, boolean]> = [
    ["email совпадает", saved.email === ADMIN_EMAIL],
    ["имя совпадает", saved.name === ADMIN_NAME],
    ["роль ADMIN", saved.role === "ADMIN"],
    ["привязан к школе Sinlycem26", saved.schoolId === school.id],
    ["не забанен", saved.isBanned === false],
    ["пароль проходит bcrypt-проверку (как при входе)", passwordOk],
  ];

  for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} Проверка: ${label}`);
  if (checks.some(([, ok]) => !ok)) {
    throw new Error("Аккаунт создан, но одна или несколько проверок не прошли — см. вывод выше");
  }

  console.log(
    `\nАккаунт ${ADMIN_EMAIL} полностью пересоздан с ролью ADMIN. Пароль: ${ADMIN_PASSWORD}. Попробуйте войти.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("Не удалось пересоздать мастер-аккаунт:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
