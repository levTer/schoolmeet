import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { conflict, handleRouteError, jsonOk, notFound } from "@/lib/api";
import { requireRole, requireViewer } from "@/lib/session-viewer";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Delete a class only when it has no students, lessons, or homework. */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    requireRole(viewer, ["ADMIN"]);
    if (!viewer.schoolId) throw notFound("Школа не найдена");

    await prisma.$transaction(
      async (tx) => {
        const schoolClass = await tx.class.findFirst({
          where: { id: params.id, schoolId: viewer.schoolId! },
          select: {
            id: true,
            _count: { select: { users: true, lessons: true, homeworks: true } },
          },
        });
        if (!schoolClass) throw notFound("Класс не найден");

        const { users, lessons, homeworks } = schoolClass._count;
        if (users + lessons + homeworks > 0) {
          throw conflict("Удалить можно только пустой класс", { users, lessons, homeworks });
        }

        await tx.class.delete({ where: { id: schoolClass.id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return jsonOk({ deleted: true });
  } catch (error) {
    return handleRouteError(error, "api/admin/classes DELETE");
  }
}
