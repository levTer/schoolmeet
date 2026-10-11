/**
 * Демо-данные SchoolMeet: три аккаунта с разными ролями.
 *
 * Роль ADMIN нельзя получить через форму регистрации (см. PUBLIC_ROLES),
 * поэтому администратора создаём здесь.
 *
 * Запуск:  npm run db:seed        (после npx prisma migrate dev / db push)
 * Пароль:  SEED_PASSWORD, по умолчанию "schoolmeet".
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/** Email-ы совпадают с демо-подсказками в src/lib/demo-accounts.ts. */
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "schoolmeet";

const ACCOUNTS = [
  { email: "admin@schoolmeet.dev", name: "Алина Смирнова", role: "ADMIN" },
  { email: "teacher@schoolmeet.dev", name: "Пётр Кузнецов", role: "TEACHER" },
  { email: "student@schoolmeet.dev", name: "Иван Петров", role: "STUDENT" },
];

async function main() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  for (const account of ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: { name: account.name, role: account.role, password: passwordHash },
      create: { ...account, password: passwordHash },
      select: { email: true, role: true },
    });

    console.log(`✓ ${user.role.padEnd(7)} ${user.email}  (пароль: ${SEED_PASSWORD})`);
  }

  console.log("\nДемо-аккаунты готовы. Админ-панель доступна ролям ADMIN и TEACHER.");
}

main()
  .catch((error) => {
    console.error("Не удалось выполнить сид:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
