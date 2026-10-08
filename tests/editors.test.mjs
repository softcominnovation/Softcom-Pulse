import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { protectedResponse } from "../lib/server/bff.ts";
import { session } from "../lib/server/auth/index.ts";
import { isEditor } from "../lib/server/auth/editors.ts";
import { issueSession } from "../lib/server/auth/corporate.ts";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const user = email => ({ id: 42, nome: "Colaborador", email, administrador: false, empresa: "JP", solicitante: 0, permissoes: [], acessos: [] });
const bearer = token => new Request("http://localhost/api/monitoring/standalone-vps", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: "{}" });

test("editor list ignores blanks and matches case and surrounding spaces", () => {
  const list = " Antonio_Abrantes@hotmail.com.br , , OUTRO@example.test ";
  assert.equal(isEditor("antonio_abrantes@hotmail.com.br", list), true);
  assert.equal(isEditor("  OUTRO@example.test ", list), true);
  assert.equal(isEditor("ausente@example.test", list), false);
  assert.equal(isEditor(null, list), false);
  assert.equal(isEditor("antonio_abrantes@hotmail.com.br", ""), false);
  assert.equal(isEditor("antonio_abrantes@hotmail.com.br", ",,,"), false);
  assert.equal(isEditor("antonio_abrantes@hotmail.com.br", undefined), false);
});

test("a valid session outside the list cannot write and a listed email can", async () => {
  const previous = process.env.PULSE_EDITOR_EMAILS;
  process.env.PULSE_EDITOR_EMAILS = " Editor@Example.test ";
  try {
    const editor = issueSession({ accessToken: "a", refreshToken: "r", tokenType: "Bearer", expiresIn: 7200, user: user("editor@example.test") });
    const reader = issueSession({ accessToken: "b", refreshToken: "r", tokenType: "Bearer", expiresIn: 7200, user: user("reader@example.test") });
    const denied = await protectedResponse(bearer(reader.accessToken), async () => ({ wrote: true }));
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: { code: "editor_required" } });
    const allowed = await protectedResponse(bearer(editor.accessToken), async () => ({ wrote: true }));
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { wrote: true });
    const reading = await protectedResponse(new Request("http://localhost/api/dashboard/overview", { headers: { Authorization: "Bearer " + reader.accessToken } }), async canEdit => ({ canEdit }));
    assert.equal(reading.status, 200);
    assert.deepEqual(await reading.json(), { canEdit: false });
    const view = await session(new Request("http://localhost/api/auth/session", { headers: { Authorization: "Bearer " + editor.accessToken } }));
    const body = await view.json();
    assert.equal(body.editor, true);
    assert.equal(JSON.stringify(body).includes("PULSE_EDITOR_EMAILS"), false);
  } finally {
    if (previous === undefined) delete process.env.PULSE_EDITOR_EMAILS;
    else process.env.PULSE_EDITOR_EMAILS = previous;
  }
});

test("an empty editor list refuses every write", async () => {
  const previous = process.env.PULSE_EDITOR_EMAILS;
  process.env.PULSE_EDITOR_EMAILS = "";
  try {
    const sessionTokens = issueSession({ accessToken: "c", refreshToken: "r", tokenType: "Bearer", expiresIn: 7200, user: user("editor@example.test") });
    const denied = await protectedResponse(bearer(sessionTokens.accessToken), async () => ({ wrote: true }));
    assert.equal(denied.status, 403);
  } finally {
    if (previous === undefined) delete process.env.PULSE_EDITOR_EMAILS;
    else process.env.PULSE_EDITOR_EMAILS = previous;
  }
});
