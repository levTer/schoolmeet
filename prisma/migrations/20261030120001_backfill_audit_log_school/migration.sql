-- Привязка старых записей аудита к школе их автора (H-03).
--
-- Колонка, внешний ключ и индекс уже созданы baseline-миграцией; здесь —
-- только перенос данных. Скрипт идемпотентен: повторный запуск ничего не
-- меняет. Записи без однозначной школы (у автора нет schoolId) остаются NULL
-- и намеренно невидимы администраторам других школ.

UPDATE "audit_logs" AS audit
SET "schoolId" = actor."schoolId"
FROM "users" AS actor
WHERE audit."userId" = actor."id"
  AND audit."schoolId" IS NULL
  AND actor."schoolId" IS NOT NULL;
