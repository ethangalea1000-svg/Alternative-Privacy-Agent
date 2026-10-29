import test from "node:test";
import assert from "node:assert/strict";
import { IDENTITY_STORAGE_KEY, emptyIdentity, parseStoredIdentity, validateIdentity } from "../identity-store.js";
import { readFile } from "node:fs/promises";
test("identity data uses a separate localStorage key and starts empty", () => {
  assert.equal(IDENTITY_STORAGE_KEY, "apa.identity.v1");
  const p = emptyIdentity(); assert.equal(p.pseudonym, ""); assert.equal(p.bio, "");
  assert.equal(p.githubUrl, ""); assert.equal(p.websiteUrl, "");
  assert.ok(Object.values(p.checklist).every((v) => v === false));
});
test("loads a valid manually entered identity", () => {
  const p = emptyIdentity(); p.pseudonym = "ExamplePenName"; p.bio = "Open-source and privacy"; p.githubUrl = "https://github.com/example";
  assert.deepEqual(parseStoredIdentity(JSON.stringify(p)), p);
});
test("rejects non-HTTPS profile links", () => {
  assert.equal(validateIdentity({ ...emptyIdentity(), websiteUrl: "http://example.com" }), false);
  assert.equal(validateIdentity({ ...emptyIdentity(), githubUrl: "javascript:alert(1)" }), false);
});
test("rejects oversized fields and control characters", () => {
  assert.equal(validateIdentity({ ...emptyIdentity(), pseudonym: "x".repeat(41) }), false);
  assert.equal(validateIdentity({ ...emptyIdentity(), bio: "x".repeat(241) }), false);
  assert.equal(validateIdentity({ ...emptyIdentity(), pseudonym: "name" + String.fromCharCode(0) + "hidden" }), false);
});
test("rejects malformed identity storage", () => {
  assert.throws(() => parseStoredIdentity("{"), SyntaxError);
  assert.throws(() => parseStoredIdentity(JSON.stringify({ pseudonym: "only one field" })), /invalide/);
});
test("profile UI has hygiene checks and no network write", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(html, /id="identity-form"/);
  assert.match(html, /Ne publiez pas de détails personnels précis : établissement ou lieu fréquenté, ville ou âge exact/);
  assert.match(html, /rien n’est prérempli ni généré/i);
  assert.match(app, /localStorage\.setItem\(IDENTITY_STORAGE_KEY/);
  assert.doesNotMatch(app, /fetch\(/);
});
