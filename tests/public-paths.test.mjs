import test from "node:test";
import assert from "node:assert/strict";
import { isPublicPath, toPublicHref } from "../lib/public/paths.ts";

test("public path detection and href mapping", () => {
  assert.equal(isPublicPath("/monitor"), true);
  assert.equal(isPublicPath("/monitor/vps/1"), true);
  assert.equal(isPublicPath("/exibicao"), true);
  assert.equal(isPublicPath("/"), false);
  assert.equal(toPublicHref("/"), "/monitor");
  assert.equal(toPublicHref("/infraestrutura"), "/monitor/infraestrutura");
  assert.equal(toPublicHref("/hosts/asgard?range=24h"), "/monitor/hosts/asgard?range=24h");
  assert.equal(toPublicHref("/admin/vps/abc"), "/monitor/vps/abc");
  assert.equal(toPublicHref("/admin/aplicacoes"), "/monitor/aplicacoes");
  assert.equal(toPublicHref("/admin/recursos"), "/monitor/recursos");
  assert.equal(toPublicHref("/servicos"), "/monitor/servicos");
  assert.equal(toPublicHref("/exibicao/vps"), "/monitor/vps");
  assert.equal(toPublicHref("/asgard?hostKey=x"), null);
  assert.equal(toPublicHref("/admin/configuracoes"), null);
  assert.equal(toPublicHref("/login"), null);
});
