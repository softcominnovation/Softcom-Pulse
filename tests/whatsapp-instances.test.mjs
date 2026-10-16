import test from "node:test";
import assert from "node:assert/strict";
import {
  createInstanceDefinition,
  defaultInstances,
  evaluateInstances,
  INSTANCE_STORAGE_KEY,
  readStoredInstances,
  removeInstanceDefinition,
  resetInstanceDefinitions,
  updateInstanceDefinition,
  writeStoredInstances,
} from "../lib/whatsapp/instances.ts";

test("default WhatsApp inventory evaluates Meta and Evolution instances with distinct semantics", () => {
  const evaluated = evaluateInstances(defaultInstances, 0);
  assert.equal(evaluated.length, 6);

  const meta = evaluated.find((item) => item.id === "meta-atendimento");
  assert.ok(meta);
  assert.equal(meta.provider, "meta");
  assert.equal(meta.status, "good");
  assert.equal(meta.enabledLabel, "Habilitado");
  assert.equal(meta.quality, "Alta");
  assert.equal(meta.sessionLabel, "Não se aplica");

  const evolution = evaluated.find((item) => item.id === "evolution-suporte");
  assert.ok(evolution);
  assert.equal(evolution.provider, "evolution");
  assert.equal(evolution.status, "good");
  assert.equal(evolution.sessionLabel, "Conectada");
  assert.equal(evolution.quality, "Não se aplica");
  assert.equal(evolution.enabledLabel, "Não se aplica");
});

test("WhatsApp instance CRUD and storage helpers preserve demo flags and mark new instances as pending", () => {
  const map = new Map();
  const storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };

  const initial = readStoredInstances(storage);
  assert.equal(initial.length, 6);

  const created = createInstanceDefinition(initial, {
    name: "Cobrança",
    provider: "meta",
    number: "+55 83 99999-0000",
    externalId: "10492837465",
  });
  assert.equal(created.id, "meta-cobranca");
  assert.equal(created.demo, false);

  const withCreated = [...initial, created];
  const evaluatedCreated = evaluateInstances(withCreated).find(
    (item) => item.id === "meta-cobranca"
  );
  assert.ok(evaluatedCreated);
  assert.equal(evaluatedCreated.status, "unknown");
  assert.equal(evaluatedCreated.evidenceSource, "Integração pendente");

  const updated = updateInstanceDefinition(withCreated, "meta-cobranca", {
    name: "Cobrança Regional",
    provider: "evolution",
    number: "+55 83 98888-1111",
  });
  const target = updated.find((item) => item.id === "meta-cobranca");
  assert.ok(target);
  assert.equal(target.name, "Cobrança Regional");
  assert.equal(target.provider, "evolution");

  writeStoredInstances(storage, updated);
  assert.ok(map.has(INSTANCE_STORAGE_KEY));

  const reloaded = readStoredInstances(storage);
  assert.equal(reloaded.length, 7);

  const afterRemove = removeInstanceDefinition(reloaded, "meta-cobranca");
  assert.equal(afterRemove.length, 6);

  const restored = resetInstanceDefinitions();
  assert.equal(restored.length, 6);
});
