/** Генерация JWT-куки NextAuth для смоук-тестов ролей. */
import { encode } from "next-auth/jwt";

const [role, name] = process.argv.slice(2);
void encode({
  token: {
    sub: `smoke-${role?.toLowerCase()}`,
    id: `smoke-${role?.toLowerCase()}`,
    name: name ?? `Smoke ${role}`,
    email: `smoke-${role?.toLowerCase()}@school.ru`,
    role,
  } as never,
  secret: process.env.NEXTAUTH_SECRET ?? "dev-smoke-secret-0123456789abcdefghijklmnop",
}).then((value) => console.log(value));
