# Admin tenant isolation

## Enforcement

Every `/api/admin/*` handler calls `requireAdminViewer()`. It reads the current
user from PostgreSQL, requires an unbanned `ADMIN` with an existing school, and
never uses a client-supplied tenant or provisions a default school. Missing
sessions return 401; invalid roles, bans, missing schools, and failed permission
checks return 403. Each admin page repeats the live check before fetching data;
a protected layout or JWT role is not the data-access boundary.

User lists, counts, details, updates, last-admin checks, statistics, attendance,
meetings, classes, announcements, and audit logs carry the verified `schoolId`.
Child resources use an explicit relation predicate. Updates use compound
`id + schoolId` predicates, and the overview cache is keyed by school. Live
Socket.IO room summaries are filtered by authenticated socket school membership.
Cross-school user IDs return 404 rather than confirming that the account exists.

The repository has no `/src/app/api/users/route.ts` and no Next.js server actions;
the admin user API is `/api/admin/users` and its `[id]` handler.

## Required database rollout

`AuditLog` now stores immutable tenant ownership separately from its author.
Apply the schema and backfill **before deploying the new application code**:

```sh
npm run db:deploy
```

Schema and backfill ship as migrations (`20261030120000_init`,
`20261030120001_backfill_audit_log_school`). A database created before the
migration history existed needs a one-time baseline:

```sh
npx prisma migrate resolve --applied 20261030120000_init
npm run db:deploy
```

The backfill attributes legacy audit rows to their author's current school.
Rows without an attributable school remain hidden; they are not guessed into a
default tenant. New audit writes always persist the verified tenant. Back up the
database before rollout and verify the row counts after the backfill.

## Verification

```sh
npm run test:security
npm test
npm run lint
```

The behavioral security tests use Node 22's experimental module mocks and an
in-memory database that evaluates tenant predicates. They cover school A/B
separation, spoofed query/body tenants, cross-school writes, unauthenticated and
stale sessions, missing schools, database failures, cache partitioning, audit
ownership, attendance, and meeting termination. They do not require a generated
Prisma client or a production database. Run a two-school smoke test against a
staging database before production rollout; mocked tests are not a substitute
for validating the deployed PostgreSQL schema and session configuration.
