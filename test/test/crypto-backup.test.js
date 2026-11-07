import test from "node:test";
import assert from "node:assert/strict";
import { encryptBackup, decryptBackup, isEncryptedBackup } from "../crypto-backup.js";

const sample = JSON.stringify({ aliases: [{ id: "a1", alias: "Lune" }] });
const pwd = "un-mot-de-passe-long";

test("encrypted backup round trips with the right password", async () => {
  const out = await encryptBackup(sample, pwd);
  assert.equal(isEncryptedBackup(out), true);
  assert.equal(out.includes("Lune"), false);
  assert.equal(await decryptBackup(out, pwd), sample);
});

test("wrong password is refused", async () => {
  const out = await encryptBackup(sample, pwd);
  await assert.rejects(() => decryptBackup(out, "mauvais-mot-de-passe"));
});

test("plain JSON backup is not detected as encrypted", () => {
  assert.equal(isEncryptedBackup(sample), false);
});

test("two exports of the same data differ (random salt and IV)", async () => {
  assert.notEqual(await encryptBackup(sample, pwd), await encryptBackup(sample, pwd));
});
