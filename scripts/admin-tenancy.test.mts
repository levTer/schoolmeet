/**
 * Behavioral admin isolation tests. Run with Node's module mocks (see package.json).
 * The in-memory database evaluates tenant predicates, rather than merely checking
 * that a source file contains the string "schoolId". No generated Prisma client,
 * Next.js build, network connection, or real database is required.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Row = Record<string, any>;
type Call = { model: string; operation: string; args: any };
const A = "school-a";
const B = "school-b";
let users: Row[];
let logs: Row[];
let meetings: Row[];
let attendance: Row[];
let submissions: Row[];
let reviews: Row[];
let session: Row | null;
let databaseFails = false;
let sessionFails = false;
let calls: Call[];
const stamp = new Date("2026-10-29T12:00:00Z");

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Row[]).some((part) => matches(row, part));
    if (key === "AND") return (value as Row[]).every((part) => matches(row, part));
    if (key === "school") return value?.isNot === null ? Boolean(row.schoolId) : row.schoolId === value?.is?.id;
    if (["meeting", "user", "host", "homework", "submission"].includes(key)) {
      const related = key === "submission" ? { homework: row.homework } : row[key];
      if (value?.is) return matches(related ?? {}, value.is);
      if (value?.some) return (related ?? []).some((child: Row) => matches(child, value.some));
      if (value?.homework) return matches(row.homework ?? {}, value.homework);
      return matches(related ?? {}, value);
    }
    if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value)) {
      if ("in" in value) return value.in.includes(row[key]);
      if ("not" in value) return row[key] !== value.not;
      if ("contains" in value) return String(row[key] ?? "").toLowerCase().includes(value.contains.toLowerCase());
      if ("gte" in value) return row[key] >= value.gte;
      if ("lt" in value) return row[key] < value.lt;
      if ("not" in value) return row[key] !== value.not;
    }
    return row[key] === value;
  });
}

function rowsFor(model: string): Row[] {
  return ({ user: users, auditLog: logs, meeting: meetings, attendanceRecord: attendance,
    homeworkSubmission: submissions, homeworkReview: reviews } as Record<string, Row[]>)[model] ?? [];
}

function delegate(model: string) {
  const record = (operation: string, args: any) => {
    calls.push({ model, operation, args: structuredClone(args) });
    if (databaseFails) throw new Error("Database unavailable");
  };
  const findMany = async (args: any) => {
    record("findMany", args);
    return rowsFor(model).filter((row) => matches(row, args.where)).slice(args.skip ?? 0, args.take === undefined ? undefined : (args.skip ?? 0) + args.take).map((row) => ({ ...row, attendance: row.attendance ?? [] }));
  };
  const findFirst = async (args: any) => {
    record("findFirst", args);
    return rowsFor(model).find((row) => matches(row, args.where)) ?? null;
  };
  const updateMany = async (args: any) => {
    record("updateMany", args);
    const found = rowsFor(model).filter((row) => matches(row, args.where));
    found.forEach((row) => Object.assign(row, args.data));
    return { count: found.length };
  };
  return {
    findMany, findFirst, updateMany,
    findFirstOrThrow: async (args: any) => {
      const row = await findFirst(args);
      assert.ok(row, "Scoped read after update must find its row");
      return row;
    },
    count: async (args: any) => {
      record("count", args);
      return rowsFor(model).filter((row) => matches(row, args.where)).length;
    },
    groupBy: async (args: any) => {
      record("groupBy", args);
      return ["ADMIN", "TEACHER", "STUDENT"].map((role) => ({ role, _count: { _all: rowsFor(model).filter((row) => matches(row, { ...args.where, role })).length } }));
    },
    create: async (args: any) => {
      record("create", args);
      const row = { id: `${model}-${rowsFor(model).length + 1}`, createdAt: stamp, updatedAt: stamp, isBanned: false, sessionVersion: 0, ...args.data };
      rowsFor(model).push(row);
      return row;
    },
    findUnique: async (args: any) => {
      record("findUnique", args);
      // Only the authentication/global-email identity lookup uses findUnique.
      return users.find((row) => matches(row, args.where)) ?? null;
    },
  };
}
const prisma = {
  user: delegate("user"), auditLog: delegate("auditLog"), meeting: delegate("meeting"),
  attendanceRecord: delegate("attendanceRecord"), homeworkSubmission: delegate("homeworkSubmission"),
  homeworkReview: delegate("homeworkReview"),
  $transaction: async (callback: (tx: unknown) => unknown) => callback(prisma),
};

class PrismaClientKnownRequestError extends Error {
  constructor(message: string, public code: string) { super(message); }
}
mock.module("@prisma/client", { namedExports: { Prisma: { PrismaClientKnownRequestError } } });
mock.module("@/lib/prisma", { namedExports: { prisma, INTERACTIVE_TRANSACTION_OPTIONS: { timeout: 15000 } } });
mock.module("@/lib/auth", { namedExports: { authOptions: {} } });
mock.module("@/lib/schools", { namedExports: { ensureUserSchoolMembership: async () => undefined } });
mock.module("next-auth", { namedExports: { getServerSession: async () => { if (sessionFails) throw new Error("Session unavailable"); return session; } } });

const usersRoute = await import("../src/app/api/admin/users/route");
const userRoute = await import("../src/app/api/admin/users/[id]/route");
const statsRoute = await import("../src/app/api/admin/stats/route");
const auditRoute = await import("../src/app/api/admin/audit/route");
const endMeetingRoute = await import("../src/app/api/meetings/[code]/end/route");
const realtimeControl = await import("../src/lib/realtime-control");
const adminUsers = await import("../src/lib/admin-users");
const adminStats = await import("../src/lib/admin-stats");
const audit = await import("../src/lib/audit");
const attendanceLib = await import("../src/lib/attendance");
const meetingsLib = await import("../src/lib/admin-meetings");
const { DomainError } = await import("../src/lib/api");

function user(id: string, schoolId: string | null, role = "STUDENT"): Row {
  return { id, schoolId, role, name: id, email: `${id}@example.test`, grade: null, classId: null,
    isBanned: false, sessionVersion: 0, createdAt: stamp, updatedAt: stamp, attendance: [] };
}
function request(path = "/", body?: Row, method = "GET") {
  return new Request(`https://example.test/api/admin/${path}`, {
    method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
}
function resourceCalls() {
  return calls.filter((call) => !(call.model === "user" && call.operation === "findFirst" && call.args.where.role === "ADMIN"));
}
function assertTenant(call: Call, schoolId: string) {
  const where = call.args.where;
  assert.ok(where, `${call.model}.${call.operation} needs a where clause`);
  assert.equal(where.schoolId ?? where.meeting?.is?.schoolId ?? where.user?.is?.schoolId ?? where.homework?.is?.schoolId ?? where.submission?.homework?.is?.schoolId, schoolId,
    `${call.model}.${call.operation} must constrain the tenant`);
}

beforeEach(() => {
  calls = [];
  databaseFails = false;
  sessionFails = false;
  session = { user: { id: "admin-a", role: "ADMIN", schoolId: A } };
  users = [user("admin-a", A, "ADMIN"), user("student-a", A), user("admin-b", B, "ADMIN"), user("student-b", B), user("orphan", null)];
  logs = [
    { id: "log-a", schoolId: A, userId: "admin-a", user: users[0], action: "user.ban", details: null, ip: null, createdAt: stamp },
    { id: "log-b", schoolId: B, userId: "admin-b", user: users[2], action: "user.ban", details: null, ip: null, createdAt: stamp },
    { id: "legacy", schoolId: null, userId: null, user: null, action: "user.ban", details: null, ip: null, createdAt: stamp },
  ];
  meetings = [
    { id: "meeting-a", schoolId: A, hostId: "admin-a", host: users[0], title: "A lesson", meetingCode: "a", isActive: true, startTime: stamp, endTime: null, attendance: [], _count: { attendance: 0 } },
    { id: "meeting-b", schoolId: B, hostId: "admin-b", host: users[2], title: "B lesson", meetingCode: "b", isActive: true, startTime: stamp, endTime: null, attendance: [], _count: { attendance: 0 } },
  ];
  attendance = [
    { id: "attendance-a", meetingId: "meeting-a", userId: "student-a", meeting: meetings[0], user: users[1], joinedAt: stamp, leftAt: null, durationMinutes: 0 },
    { id: "attendance-b", meetingId: "meeting-b", userId: "student-b", meeting: meetings[1], user: users[3], joinedAt: stamp, leftAt: null, durationMinutes: 0 },
  ];
  submissions = [
    { id: "submission-a", status: "SUBMITTED", submittedAt: stamp, homework: { schoolId: A, grade: "GRADE_5" } },
    { id: "submission-b", status: "SUBMITTED", submittedAt: stamp, homework: { schoolId: B, grade: "GRADE_5" } },
  ];
  reviews = submissions.map((submission) => ({ grade: 5, approvedAt: stamp, submission }));
  adminStats.invalidateAdminOverview();
});

describe("Admin user management: school A cannot read or mutate school B", () => {
  it("GET lists/counts only the live database administrator's school, ignoring a spoofed query tenant", async () => {
    const response = await usersRoute.GET(request("users?schoolId=school-b&search=student"));
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.deepEqual(data.items.map((row: Row) => row.id), ["student-a"]);
    assert.equal(data.total, 1);
    assert.ok(resourceCalls().length >= 2);
    resourceCalls().forEach((call) => assertTenant(call, A));
  });

  it("the same query as school B returns B, never A or unassigned users", async () => {
    session = { user: { id: "admin-b" } };
    const result = await adminUsers.listUsersForAdmin(B, { search: "student", page: 1 });
    assert.deepEqual(result.items.map((row) => row.id), ["student-b"]);
    assert.equal(result.total, 1);
    resourceCalls().forEach((call) => assertTenant(call, B));
  });

  it("cross-school detail reads return 404 and cross-school writes never reach updateMany", async () => {
    const detail = await userRoute.GET(request("users/student-b"), { params: { id: "student-b" } });
    assert.equal(detail.status, 404);
    const patch = await userRoute.PATCH(request("users/student-b", { isBanned: true }, "PATCH"), { params: { id: "student-b" } });
    assert.equal(patch.status, 404);
    assert.equal(users.find((row) => row.id === "student-b")!.isBanned, false);
    assert.equal(calls.some((call) => call.operation === "updateMany"), false);
    resourceCalls().forEach((call) => assertTenant(call, A));
  });

  it("updates use a compound id + schoolId predicate inside a transaction", async () => {
    const result = await adminUsers.updateUserAsAdmin("student-a", A, { name: "Updated student" });
    assert.equal(result.user.name, "Updated student");
    const update = resourceCalls().find((call) => call.operation === "updateMany")!;
    assert.deepEqual(update.args.where, { id: "student-a", schoolId: A });
    assert.equal(update.args.data.schoolId, undefined);
    await assert.rejects(adminUsers.updateUserAsAdmin("student-b", A, { name: "Leak" }), (error: unknown) => error instanceof DomainError && error.status === 404);
  });

  it("creates users in the operator's tenant even when the body supplies another schoolId", async () => {
    const response = await usersRoute.POST(request("users", { name: "New student", email: "new@example.test", password: "Strong-password-42!", role: "STUDENT", schoolId: B }, "POST"));
    assert.equal(response.status, 201);
    const created = users.find((row) => row.email === "new@example.test")!;
    assert.equal(created.schoolId, A);
    const create = calls.find((call) => call.model === "user" && call.operation === "create")!;
    assert.equal(create.args.data.schoolId, A);
  });

  it("tenant filters cannot be replaced by search/role options", async () => {
    await adminUsers.listUsersForAdmin(A, { search: "student", role: "STUDENT", bannedOnly: true });
    resourceCalls().forEach((call) => {
      assertTenant(call, A);
      assert.equal(call.args.where.role, "STUDENT");
      assert.equal(call.args.where.isBanned, true);
      assert.ok(call.args.where.OR);
    });
  });
});

describe("Admin authorization fails closed before resource queries", () => {
  for (const [name, setup, expected] of [
    ["unauthenticated", () => { session = null; }, 401],
    ["no school", () => { users[0].schoolId = null; }, 403],
    ["banned administrator", () => { users[0].isBanned = true; }, 403],
    ["stale JWT role", () => { users[0].role = "TEACHER"; }, 403],
    ["database failure", () => { databaseFails = true; }, 403],
    ["session failure", () => { sessionFails = true; }, 403],
  ] as const) {
    it(`${name}: HTTP ${expected}, no user list/count query`, async () => {
      setup();
      const response = await usersRoute.GET(request("users"));
      assert.equal(response.status, expected);
      assert.equal(resourceCalls().length, 0);
    });
  }

  it("services reject a missing tenant before issuing any database query", async () => {
    for (const action of [
      () => adminUsers.listUsersForAdmin(""), () => adminUsers.getUserForAdmin("student-b", ""),
      () => adminUsers.updateUserAsAdmin("student-b", "", { name: "No" }),
      () => adminStats.getAdminOverview(""), () => adminStats.getAdminSecondaryMetrics(""),
      () => audit.listAuditLogs(""), () => meetingsLib.listActiveMeetings(""),
      () => attendanceLib.listAttendance({ schoolId: "" }),
    ]) {
      await assert.rejects(action(), (error: unknown) => error instanceof DomainError && error.status === 403);
    }
    assert.equal(calls.length, 0);
  });
});

describe("Admin overview, audit, meetings and attendance are tenant-scoped", () => {
  it("overview cache is partitioned by school, including secondary metrics", async () => {
    const a = await adminStats.getAdminOverview(A, stamp);
    session = { user: { id: "admin-b" } };
    const b = await adminStats.getAdminOverview(B, stamp);
    assert.equal(a.generatedAt, b.generatedAt);
    assert.notDeepEqual(a.recentAudit, b.recentAudit);
    assert.deepEqual(a.recentAudit.map((row) => row.id), ["log-a"]);
    assert.deepEqual(b.recentAudit.map((row) => row.id), ["log-b"]);
    await adminStats.getAdminSecondaryMetrics(A);
    await adminStats.getAdminSecondaryMetrics(B);
    resourceCalls().forEach((call) => assertTenant(call, call.args.where?.schoolId === B || call.args.where?.meeting?.is?.schoolId === B || call.args.where?.homework?.is?.schoolId === B || call.args.where?.submission?.homework?.is?.schoolId === B ? B : A));
    const response = await statsRoute.GET();
    assert.equal(response.status, 200);
  });

  it("audit lists/counts exclude B and unowned legacy rows, and new logs persist tenant ownership", async () => {
    const response = await auditRoute.GET(request("audit"));
    const { data } = await response.json();
    assert.deepEqual(data.items.map((row: Row) => row.id), ["log-a"]);
    assert.equal(data.total, 1);
    await audit.writeAuditLog({ schoolId: A, userId: "admin-a", action: "user.update" });
    assert.equal(logs.at(-1)!.schoolId, A);
    resourceCalls().filter((call) => call.operation !== "create").forEach((call) => assertTenant(call, A));
    calls = [];
    await audit.writeAuditLog({ schoolId: "", action: "user.update" });
    assert.equal(calls.length, 0);
  });

  it("active meetings and attendance only return the caller's school", async () => {
    const summary = await meetingsLib.listActiveMeetings(A);
    assert.deepEqual(summary.items.map((row) => row.id), ["meeting-a"]);
    const result = await attendanceLib.listAttendance({ schoolId: A, meetingId: "meeting-b" });
    assert.equal(result.total, 0);
    assert.deepEqual(result.items, []);
    resourceCalls().forEach((call) => assertTenant(call, A));
  });

  it("force-end and stale-attendance cleanup cannot modify school B", async () => {
    await assert.rejects(meetingsLib.forceEndMeeting("meeting-b", A), /MEETING_NOT_FOUND/);
    assert.equal(meetings[1].endTime, null);
    await meetingsLib.forceEndMeeting("meeting-a", A);
    await attendanceLib.finishStaleAttendance(A, new Date(stamp.getTime() + 24 * 60 * 60 * 1000));
    await attendanceLib.closeAttendanceForUser("student-b", A);
    assert.equal(attendance[1].leftAt, null);
    resourceCalls().forEach((call) => assertTenant(call, A));
  });
});

describe("Admin boundary source audit", () => {
  it("every admin route checks the live tenant administrator independently of middleware", () => {
    const root = new URL("../src/app/api/admin/", import.meta.url);
    const paths = ["users/route.ts", "users/[id]/route.ts", "stats/route.ts", "audit/route.ts", "attendance/route.ts", "meetings/route.ts", "meetings/[id]/end/route.ts", "classes/route.ts", "classes/[id]/route.ts", "announcements/route.ts", "announcements/[id]/route.ts"];
    for (const path of paths) {
      const source = readFileSync(fileURLToPath(new URL(path, root)), "utf8");
      assert.match(source, /await requireAdminViewer\(\)/, path);
      assert.doesNotMatch(source, /await require(?:School)?Viewer\(\)/, path);
    }
  });
  it("every admin page checks the database before fetching data", () => {
    for (const page of ["page", "users/page", "audit/page", "meetings/page", "announcements/page"]) {
      const source = readFileSync(fileURLToPath(new URL(`../src/app/admin/${page}.tsx`, import.meta.url)), "utf8");
      assert.match(source, /const admin = await getLiveAdminViewer\(\)/, page);
      assert.ok(source.indexOf("await getLiveAdminViewer()") < source.search(/await (?:list|getAdmin|Promise\.all)/), page);
    }
  });
});

describe("POST /api/meetings/[id]/end: host/ADMIN authorization and schoolId tenancy", () => {
  it("allows the meeting host (TEACHER) and school ADMIN to end an active meeting, emits CALL_ENDED, and blocks students, other teachers, and other schools", async () => {
    const hostTeacherA = user("teacher-host-a", A, "TEACHER");
    const otherTeacherA = user("teacher-other-a", A, "TEACHER");
    users.push(hostTeacherA, otherTeacherA);
    meetings.push({
      id: "meeting-live-a",
      schoolId: A,
      hostId: "teacher-host-a",
      host: hostTeacherA,
      title: "Внеплановый урок",
      meetingCode: "vneplanovyy-a",
      isActive: true,
      status: "active",
      startTime: stamp,
      endTime: null,
      attendance: [],
      _count: { attendance: 0 },
    });

    const broadcasted: Array<{ schoolId: string; meetingId: string; meetingCode: string }> = [];
    realtimeControl.registerRealtimeControl({
      listLiveRooms: () => [],
      countParticipants: () => 0,
      closeMeeting: () => ({ closedSockets: 0, roomIds: [] }),
      endCallForAll: (opts) => {
        broadcasted.push({ schoolId: opts.schoolId, meetingId: opts.meetingId, meetingCode: opts.meetingCode });
        return { closedSockets: 2, roomId: `room:${opts.schoolId}:${opts.meetingCode}` };
      },
      disconnectUser: () => 0,
      isUserOnline: () => false,
    });

    try {
      // 1. Student in school A cannot end the meeting (403)
      session = { user: { id: "student-a", role: "STUDENT", schoolId: A } };
      const studentRes = await endMeetingRoute.POST(
        new Request("https://example.test/api/meetings/meeting-live-a/end", { method: "POST" }),
        { params: { code: "meeting-live-a" } },
      );
      assert.equal(studentRes.status, 403);
      assert.equal(meetings.find((m) => m.id === "meeting-live-a")!.status, "active");

      // 2. Non-host teacher in school A cannot end the meeting (403)
      session = { user: { id: "teacher-other-a", role: "TEACHER", schoolId: A } };
      const otherTeacherRes = await endMeetingRoute.POST(
        new Request("https://example.test/api/meetings/meeting-live-a/end", { method: "POST" }),
        { params: { code: "meeting-live-a" } },
      );
      assert.equal(otherTeacherRes.status, 403);
      assert.equal(meetings.find((m) => m.id === "meeting-live-a")!.status, "active");

      // 3. Admin in school B cannot see or end school A's meeting (404)
      session = { user: { id: "admin-b", role: "ADMIN", schoolId: B } };
      const crossTenantRes = await endMeetingRoute.POST(
        new Request("https://example.test/api/meetings/meeting-live-a/end", { method: "POST" }),
        { params: { code: "meeting-live-a" } },
      );
      assert.equal(crossTenantRes.status, 404);
      assert.equal(meetings.find((m) => m.id === "meeting-live-a")!.status, "active");
      assert.equal(broadcasted.length, 0);

      // 4. Host teacher in school A ends their meeting -> 200, status = ended, CALL_ENDED emitted
      session = { user: { id: "teacher-host-a", role: "TEACHER", schoolId: A } };
      const hostRes = await endMeetingRoute.POST(
        new Request("https://example.test/api/meetings/meeting-live-a/end", { method: "POST" }),
        { params: { code: "meeting-live-a" } },
      );
      assert.equal(hostRes.status, 200);
      const hostJson = await hostRes.json();
      assert.equal(hostJson.ok, true);
      assert.equal(hostJson.data.status, "ended");
      const updatedByHost = meetings.find((m) => m.id === "meeting-live-a")!;
      assert.equal(updatedByHost.status, "ended");
      assert.equal(updatedByHost.isActive, false);
      assert.ok(updatedByHost.endTime instanceof Date);
      assert.equal(broadcasted.length, 1);
      assert.deepEqual(broadcasted[0], {
        schoolId: A,
        meetingId: "meeting-live-a",
        meetingCode: "vneplanovyy-a",
      });

      // 5. School ADMIN in school A can also end another teacher's active meeting
      meetings.push({
        id: "meeting-live-a2",
        schoolId: A,
        hostId: "teacher-host-a",
        host: hostTeacherA,
        title: "Внеплановый урок 2",
        meetingCode: "vneplanovyy-a2",
        isActive: true,
        status: "active",
        startTime: stamp,
        endTime: null,
        attendance: [],
        _count: { attendance: 0 },
      });
      session = { user: { id: "admin-a", role: "ADMIN", schoolId: A } };
      const adminRes = await endMeetingRoute.POST(
        new Request("https://example.test/api/meetings/meeting-live-a2/end", { method: "POST" }),
        { params: { code: "meeting-live-a2" } },
      );
      assert.equal(adminRes.status, 200);
      const updatedByAdmin = meetings.find((m) => m.id === "meeting-live-a2")!;
      assert.equal(updatedByAdmin.status, "ended");
      assert.equal(updatedByAdmin.isActive, false);
      assert.ok(updatedByAdmin.endTime instanceof Date);
      assert.equal(broadcasted.length, 2);
    } finally {
      realtimeControl.unregisterRealtimeControl();
    }
  });
});
