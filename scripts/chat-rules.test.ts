/**
 * Тесты приватных сообщений в чате урока.
 * Запуск: `npm run test:chat`. База данных, сокеты и браузер не нужны.
 *
 * Проверяются:
 *  1. `resolveRecipientId` — кого считать адресатом и какой мусор отклонять;
 *  2. видимость сообщений: публичное видят все, приватное — только автор и
 *     адресат, причём SQL-фильтр истории (`chatVisibilityWhere`) совпадает с
 *     правилом `canViewChatMessage` на полном переборе комбинаций;
 *  3. подписи «Приватно для …» / «Приватно от …»;
 *  4. контракт связности: схема, серверная доставка, выборка истории и UI чата
 *     действительно работают с `recipientId` (строковые проверки по исходникам —
 *     регресс «сообщение ушло всей комнате» виден сразу).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  CHAT_RECIPIENT_EVERYONE,
  canPinChatMessage,
  canViewChatEnvelope,
  canViewChatMessage,
  chatVisibilityWhere,
  describePrivateMessage,
  resolveRecipientId,
  type ChatVisibility,
} from "../src/lib/chat-rules";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

const TEACHER = "user-teacher";
const STUDENT_A = "user-student-a";
const STUDENT_B = "user-student-b";

const PUBLIC_MESSAGE: ChatVisibility = { userId: TEACHER, recipientId: null };
const PRIVATE_A_TO_B: ChatVisibility = { userId: STUDENT_A, recipientId: STUDENT_B };
const PRIVATE_TEACHER_TO_A: ChatVisibility = { userId: TEACHER, recipientId: STUDENT_A };

describe("resolveRecipientId — кого считать адресатом", () => {
  it("«Всем»: undefined, null и пустая строка дают публичное сообщение", () => {
    for (const raw of [undefined, null, CHAT_RECIPIENT_EVERYONE, "   "]) {
      const result = resolveRecipientId(raw, STUDENT_A);
      assert.deepEqual(result, { ok: true, recipientId: null }, `не обработано ${JSON.stringify(raw)}`);
    }
  });

  it("валидный id участника становится адресатом", () => {
    assert.deepEqual(resolveRecipientId(STUDENT_B, STUDENT_A), { ok: true, recipientId: STUDENT_B });
  });

  it("пробелы вокруг id обрезаются", () => {
    assert.deepEqual(resolveRecipientId(`  ${STUDENT_B}\n`, STUDENT_A), { ok: true, recipientId: STUDENT_B });
  });

  it("приватное сообщение самому себе отклоняется", () => {
    const result = resolveRecipientId(STUDENT_A, STUDENT_A);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SELF_RECIPIENT");
  });

  it("мусор вместо id отклоняется: не-строка и слишком длинное значение", () => {
    for (const raw of [42, {}, [], "x".repeat(65)]) {
      const result = resolveRecipientId(raw, STUDENT_A);
      assert.equal(result.ok, false, `не отклонено ${JSON.stringify(raw)}`);
      if (!result.ok) assert.equal(result.code, "BAD_RECIPIENT");
    }
  });
});

describe("видимость сообщений в ленте", () => {
  it("публичное сообщение видит каждый участник урока", () => {
    for (const viewer of [TEACHER, STUDENT_A, STUDENT_B]) {
      assert.equal(canViewChatMessage(PUBLIC_MESSAGE, viewer), true, `не увидел ${viewer}`);
    }
  });

  it("приватное видят только автор и адресат", () => {
    assert.equal(canViewChatMessage(PRIVATE_A_TO_B, STUDENT_A), true, "автор не видит своё сообщение");
    assert.equal(canViewChatMessage(PRIVATE_A_TO_B, STUDENT_B), true, "адресат не видит сообщение");
    assert.equal(canViewChatMessage(PRIVATE_A_TO_B, TEACHER), false, "приватное сообщение утекло третьему");
  });

  it("учитель не видит приватную переписку учеников между собой", () => {
    assert.equal(canViewChatMessage(PRIVATE_A_TO_B, TEACHER), false);
    assert.equal(canViewChatMessage(PRIVATE_TEACHER_TO_A, STUDENT_B), false);
  });

  it("без идентификатора зрителя не видно ничего, даже публичного", () => {
    assert.equal(canViewChatMessage(PUBLIC_MESSAGE, ""), false);
  });

  it("конверт сообщения проверяется по тем же правилам", () => {
    const envelope = {
      author: { userId: STUDENT_A, name: "Аня" },
      recipient: { userId: STUDENT_B, name: "Боря" },
    };
    assert.equal(canViewChatEnvelope(envelope, STUDENT_A), true);
    assert.equal(canViewChatEnvelope(envelope, STUDENT_B), true);
    assert.equal(canViewChatEnvelope(envelope, TEACHER), false);
    assert.equal(canViewChatEnvelope({ ...envelope, recipient: null }, TEACHER), true);
  });
});

describe("SQL-фильтр истории совпадает с правилом видимости", () => {
  const messages = [PUBLIC_MESSAGE, PRIVATE_A_TO_B, PRIVATE_TEACHER_TO_A];

  /** Применяет OR-условия так же, как это сделает Prisma/Postgres. */
  const matchesWhere = (message: ChatVisibility, viewer: string): boolean =>
    chatVisibilityWhere(viewer).some((condition) =>
      Object.entries(condition).every(
        ([field, expected]) => message[field as keyof ChatVisibility] === expected,
      ),
    );

  it("полный перебор: выборка = правило видимости", () => {
    for (const viewer of [TEACHER, STUDENT_A, STUDENT_B, ""]) {
      for (const message of messages) {
        assert.equal(
          matchesWhere(message, viewer),
          canViewChatMessage(message, viewer),
          `расхождение для зрителя ${viewer} и сообщения ${JSON.stringify(message)}`,
        );
      }
    }
  });

  it("учитель получает публичные и адресованные ему, но не переписку учеников", () => {
    assert.deepEqual(messages.filter((message) => matchesWhere(message, TEACHER)), [
      PUBLIC_MESSAGE,
      PRIVATE_TEACHER_TO_A,
    ]);
  });

  it("ученик Б получает публичные и адресованные ему", () => {
    assert.deepEqual(messages.filter((message) => matchesWhere(message, STUDENT_B)), [
      PUBLIC_MESSAGE,
      PRIVATE_A_TO_B,
    ]);
  });

  it("без зрителя история пуста — не видно даже публичных сообщений", () => {
    assert.deepEqual(messages.filter((message) => matchesWhere(message, "")), []);
  });
});

describe("подписи приватных сообщений", () => {
  it("своё сообщение — «Приватно для [Имя]»", () => {
    assert.equal(
      describePrivateMessage({ isMine: true, counterpartName: "Боря" }),
      "Приватно для Боря",
    );
  });

  it("чужое сообщение — «Приватно от [Имя]»", () => {
    assert.equal(
      describePrivateMessage({ isMine: false, counterpartName: "Анна Иванова" }),
      "Приватно от Анна Иванова",
    );
  });

  it("пустое имя не ломает подпись", () => {
    assert.equal(describePrivateMessage({ isMine: true, counterpartName: "  " }), "Приватно для участника");
  });
});

describe("контракт связности (схема → сервер → клиент)", () => {
  const schema = readSource("prisma/schema.prisma");
  const meetings = readSource("src/lib/meetings.ts");
  const realtimeServer = readSource("src/server/realtime.ts");
  const chat = readSource("src/components/meeting/Chat.tsx");
  const meetingRoom = readSource("src/components/meeting/MeetingRoom.tsx");

  it("в схеме ChatMessage есть опциональный recipientId со связью и индексом", () => {
    const model = schema.slice(schema.indexOf("model ChatMessage {"));
    assert.match(model, /recipientId\s+String\?/, "нет recipientId String?");
    assert.match(model, /recipient\s+User\?\s+@relation\("ChatMessageRecipient"/, "нет связи с получателем");
    assert.match(model, /@@index\(\[recipientId\]\)/, "нет индекса по recipientId");
  });

  it("сохранение сообщения пишет recipientId и подтягивает имя получателя", () => {
    assert.match(meetings, /recipientId\?: string \| null;/, "saveChatMessage не принимает адресата");
    assert.match(meetings, /CHAT_RECIPIENT_NOT_FOUND/, "нет проверки получателя");
    assert.match(meetings, /recipient: \{ select: \{ id: true, name: true \} \}/, "имя получателя не выбирается");
  });

  it("история чата выбирается с фильтром видимости зрителя", () => {
    assert.match(meetings, /OR: chatVisibilityWhere\(viewerUserId\)/, "история отдаётся без фильтра");
    assert.match(realtimeServer, /loadRecentMessages\(meeting\.id, socket\.data\.user\.schoolId, socket\.data\.user\.id\)/, "join-room не передаёт зрителя");
  });

  it("приватное сообщение сервер шлёт только автору и адресату", () => {
    assert.match(realtimeServer, /resolveRecipientId\(payload\?\.recipientId, socket\.data\.user\.id\)/, "адресат не проверяется");
    assert.match(realtimeServer, /RECIPIENT_NOT_IN_ROOM/, "нет проверки, что адресат в комнате");
    assert.match(realtimeServer, /if \(envelope\.recipient\) \{/, "нет ветки приватной доставки");
    assert.match(
      realtimeServer,
      /targetUserId === envelope\.author\.userId \|\| targetUserId === envelope\.recipient\.userId/,
      "приватное сообщение рассылается не тем участникам",
    );
  });

  it("в чате есть компактный селект адресата с «Всем» по умолчанию", () => {
    assert.match(chat, /id="chat-recipient"/, "нет селекта адресата");
    assert.match(chat, /value=\{recipientId \?\? CHAT_RECIPIENT_EVERYONE\}/, "селект не управляемый");
    assert.match(chat, />\s*\n\s*Всем\s*\n\s*<\/option>/, "нет варианта «Всем»");
    assert.match(chat, /onSend\(text, recipientId\)/, "адресат не передаётся при отправке");
    assert.match(chat, /recipients\.some\(\(item\) => item\.userId === recipientId\)/, "выбранный адресат не сбрасывается при выходе");
  });

  it("приватные сообщения выделены в ленте: фон, 🔒 и подпись", () => {
    assert.match(chat, /bg-indigo-900\/40/, "приватное сообщение не отличается фоном");
    assert.match(chat, /🔒/, "нет иконки приватности");
    assert.match(chat, /describePrivateMessage\(\{/, "подпись не берётся из общих правил");
  });

  it("плашку закреплённого сообщения ведёт только учитель или администратор", () => {
    assert.equal(canPinChatMessage("TEACHER"), true, "учитель должен закреплять сообщения");
    assert.equal(canPinChatMessage("ADMIN"), true, "администратор должен закреплять сообщения");
    assert.equal(canPinChatMessage("STUDENT"), false, "ученик не должен закреплять сообщения");
  });

  it("плашка закреплённого сообщения: крестик сбрасывает закрепление у всей комнаты", () => {
    const realtimeContract = readSource("src/lib/realtime.ts");
    const realtimeServer = readSource("src/server/realtime.ts");
    const socketHook = readSource("src/hooks/useSocket.ts");

    assert.match(realtimeContract, /\"pin-message\"/, "контракт не описывает закрепление сообщения");
    assert.match(realtimeContract, /\"pinned-message\"/, "контракт не описывает событие плашки");
    assert.match(realtimeServer, /canPinChatMessage\(socket\.data\.user\.role\)/, "сервер не проверяет право закрепления");
    assert.match(realtimeServer, /loadChatEnvelopeById/, "сервер не умеет взять сообщение по id");
    assert.match(realtimeServer, /canViewChatEnvelope\(envelope, socket\.data\.user\.id\)/, "приватное сообщение может утечь в общую плашку");
    assert.match(realtimeServer, /emit\("pinned-message", \{ pinned: null \}\)/, "открепление не рассылается комнате");
    assert.match(socketHook, /pinMessage/, "хук сокета не умеет закреплять/откреплять");
  });

  it("комната урока передаёт в чат участников и адресата при отправке", () => {
    assert.equal(meetingRoom.match(/recipients=\{chatRecipients\}/g)?.length, 2, "селект адресата не во всех панелях чата");
    assert.match(meetingRoom, /participant\.userId === self\.id/, "автор попадает в список адресатов");
    assert.match(meetingRoom, /sendChat\(ciphertext, recipientId\)/, "адресат не уходит на сервер");
    assert.match(meetingRoom, /recipient: message\.recipient/, "получатель теряется при сборке ленты");
  });
});
