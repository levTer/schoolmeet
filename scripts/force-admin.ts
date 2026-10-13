/**
 * Ядерный фикс мастер-аккаунта администратора: синхронизация bcrypt-хеша.
 *
 * Проблема, которую это решает: аккаунт в БД есть, но NextAuth его не пускает.
 * Причина почти всегда одна из трёх — пароль захеширован не тем алгоритмом/
 * не той библиотекой, роль не ADMIN или аккаунт не привязан к школе. Скрипт
 * не чинит старую запись, а пересоздаёт её с нуля, поэтому все три причины
 * уходят разом.
 *
 * Синхронизация хеша: проект проверяет пароль в `src/lib/auth.ts` через
 * `verifyPassword` (`src/lib/password.ts` → `bcryptjs.compare`, 10 раундов).
 * Здесь хеш создаётся той же библиотекой и с той же стоимостью —
 * `bcryptjs.hashSync(password, 10)`, — поэтому `compare` при входе обязан
 * совпасть. В конце скрипт это доказывает самопроверкой compareSync.
 *
 * Что делает:
 *   1. Находит школу `Sinlycem26`; нет — создаёт (сразу с токенами
 *      приглашений, как `provisionConfiguredSchools` в `src/lib/schools.ts`).
 *   2. Удаляет старого пользователя `admin@sinlycem.ru`, если он есть
 *      (связанные записи удалятся каскадно по `onDelete: Cascade` схемы).
 *   3. Создаёт пользователя заново: роль ADMIN, привязка к школе, не забанен.
 *   4. Перечитывает созданного пользователя из БД и проверяет пароль.
 *
 * Запуск:  npx tsx scripts/force-admin.ts
 * Требуется DATABASE_URL той БД, к которой подключено приложение.
 */
import { PrismaClient } from "@prisma/client";
import bcryptjs from "bcryptjs";

import { inviteTokensForNewSchool } from "../src/lib/invite-tokens";

const prisma = new PrismaClient();

const SCHOOL_CODE = "Sinlycem26";
const SCHOOL_NAME = "Лицей Сингулярити"; // CONFIGURED_SCHOOLS в src/lib/school-config.ts
const ADMIN_EMAIL = "admin@sinlycem.ru";
const ADMIN_PASSWORD = "lev_Terentiev2012!";
const ADMIN_NAME = "Лев (Главный Админ)";

async function main(): Promise<void> {
  // 1. Школа: сначала точный код, затем без учёта регистра
  //    (коды школ хранятся «как написаны», см. school-config.ts).
  const school =
    (await prisma.school.findUnique({
      where: { code: SCHOOL_CODE },
      select: { id: true, name: true, code: true },
    })) ??
    (await prisma.school.findFirst({
      where: { code: { equals: SCHOOL_CODE, mode: "insensitive" } },
      select: { id: true, name: true, code: true },
    })) ??
    (await prisma.school.create({
      data: { name: SCHOOL_NAME, code: SCHOOL_CODE, ...inviteTokensForNewSchool(SCHOOL_CODE) },
      select: { id: true, name: true, code: true },
    }));

  console.log(`✓ Школа: ${school.name} (code=${school.code}, id=${school.id})`);

  // 2. Старый аккаунт — под снос: с битым хешем/ролью NextAuth его не примет,
  //    а update мог бы оставить другие испорченные поля (бан, чужая школа).
  const deleted = await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  console.log(deleted.count > 0 ? "• Старый аккаунт admin@sinlycem.ru удалён" : "• Старого аккаунта не было — создаю с нуля");

  // 3. Хеш — синхронно, той же библиотекой (bcryptjs) и с той же стоимостью
  //    (10), что использует проверка пароля при входе.
  const passwordHash = bcryptjs.hashSync(ADMIN_PASSWORD, 10);

  const created = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      password: passwordHash,
      name: ADMIN_NAME,
      role: "ADMIN",
      schoolId: school.id,
      // Явно, а не по умолчанию: админ — не ученик и не должен быть забанен,
      // иначе authorize в src/lib/auth.ts всё равно его не пустит.
      grade: null,
      classId: null,
      isBanned: false,
    },
    select: { id: true, email: true },
  });
  console.log(`✓ Создан пользователь: ${created.email} (id=${created.id}, роль ADMIN, школа ${school.code})`);

  // 4. Проверка именно СОХРАНЁННОГО хеша: перечитываем запись из БД,
  //    а не объект, который только что отправили в create.
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: ADMIN_EMAIL },
    select: { email: true, role: true, schoolId: true, isBanned: true, password: true },
  });
  if (user.role !== "ADMIN" || user.schoolId !== school.id || user.isBanned) {
    throw new Error(
      `Аккаунт создан, но поля не сошлись: role=${user.role}, schoolId=${user.schoolId}, isBanned=${user.isBanned}`,
    );
  }

  console.log("Проверка пароля:", bcryptjs.compareSync("lev_Terentiev2012!", user.password));
}

main()
  .catch((error: unknown) => {
    console.error("Не удалось пересоздать аккаунт администратора:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
