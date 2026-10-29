import { tenantRequired } from "@/lib/api";

/**
 * Fail closed before an admin query can run without a tenant. Spread this last
 * into a Prisma `where` so caller-supplied filters cannot override ownership.
 * Resources without a schoolId column use `relation: { is: schoolScope(id) }`.
 */
export function schoolScope(schoolId: string): { schoolId: string } {
  if (typeof schoolId !== "string" || !schoolId.trim()) throw tenantRequired();
  return { schoolId };
}
