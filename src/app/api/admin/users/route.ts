import { NextResponse } from "next/server";

import { handleRouteError, jsonError, jsonOk, parseIntParam } from "@/lib/api";
import {
  USERS_PAGE_SIZE,
  USERS_PAGE_SIZE_MAX,
  createUserAsAdmin,
  listUsersForAdmin,
  normalizeSearchTerm,
  parseGrade,
  parseRole,
  validateUserCreate,
} from "@/lib/admin-users";
import { getRequestIp, writeAuditLog } from "@/lib/audit";
import { invalidateAdminOverview } from "@/lib/admin-stats";
import { requireCapability, requireSchoolViewer, requireViewer } from "@/lib/session-viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users — список пользователей с поиском и фильтрами.
 *
 * Параметры: `search` (имя или email), `role` (STUDENT/TEACHER/ADMIN),
 * `grade` (GRADE_5…GRADE_11), `banned=1`, `page`, `pageSize`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const viewer = await requireViewer();
    requireCapability(viewer, "users.view");

    const { searchParams } = new URL(request.url);
    const result = await listUsersForAdmin({
      search: normalizeSearchTerm(searchParams.get("search")),
      role: parseRole(searchParams.get("role")),
      grade: parseGrade(searchParams.get("grade")),
      bannedOnly: searchParams.get("banned") === "1",
      page: parseIntParam(searchParams.get("page"), 1, 1),
      pageSize: parseIntParam(searchParams.get("pageSize"), USERS_PAGE_SIZE, 1, USERS_PAGE_SIZE_MAX),
    });

    return jsonOk(result);
  } catch (error) {
    return handleRouteError(error, "api/admin/users GET");
  }
}

/**
 * POST /api/admin/users — создать пользователя (в том числе администратора).
 * Доступно только роли ADMIN: создание аккаунтов с произвольной ролью —
 * привилегированная операция.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Школа нового пользователя — школа оператора (из сессии), а не из тела
    // запроса и не «основная школа по умолчанию» (исправление M-02).
    const viewer = await requireSchoolViewer();
    requireCapability(viewer, "users.create");

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonError(400, "BAD_REQUEST", "Ожидается JSON с данными пользователя");
    }

    const validation = validateUserCreate(payload);
    if (!validation.ok) {
      return jsonError(422, "VALIDATION_ERROR", validation.error, { fields: validation.fields });
    }

    const user = await createUserAsAdmin(validation.data, viewer.schoolId);
    invalidateAdminOverview();

    void writeAuditLog({
      userId: viewer.id,
      action: "user.create",
      ip: getRequestIp(request),
      details: { target: user.email, role: user.role, grade: user.grade ?? undefined, schoolId: viewer.schoolId },
    });

    return jsonOk({ user }, 201);
  } catch (error) {
    return handleRouteError(error, "api/admin/users POST");
  }
}
