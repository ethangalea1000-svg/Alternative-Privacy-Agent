import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseStoredAliases, serializeAliases, parseBackup, mergeImportedAliases, updateAlias, validateAlias, STORAGE_KEY } from "../prototype-store.js";
const base = { id:"id-1", name:"Shopping", label:"shopping-ab12", category:"achats", status:"active", createdAt:"2026-10-01T12:00:00.000Z", site:"Example Store", notes:"Alias used for receipts" };

test("storage key remains compatible", () => assert.equal(STORAGE_KEY, "apa.aliases.v1"));
test("loads old aliases and supplies empty site and notes", () => {
 const old={...base}; delete old.site; delete old.notes;
 const result=parseStoredAliases(JSON.stringify([old]));
 assert.equal(result.length,1); assert.equal(result[0].site,""); assert.equal(result[0].notes,""); assert.equal(result[0].name,old.name);
});
test("filters invalid local records", () => assert.deepEqual(parseStoredAliases(JSON.stringify([base,{id:"bad"}])),[{...base}]));
test("validates site and notes lengths and control characters", () => {
 assert.equal(validateAlias({...base,site:"x".repeat(121)}),false);
 assert.equal(validateAlias({...base,notes:"x".repeat(1001)}),false);
 assert.equal(validateAlias({...base,site:"shop\u0000name"}),false);
 assert.equal(validateAlias({...base,notes:"note\u0001bad"}),false);
 assert.equal(validateAlias(base),true);
});
test("exports a versioned JSON backup and restores it", () => {
 const text=serializeAliases([base]); const parsed=JSON.parse(text);
 assert.equal(parsed.format,"APA-LOCAL-BACKUP"); assert.equal(parsed.version,1); assert.deepEqual(parseBackup(text),[base]);
});
test("imports legacy JSON array for backwards compatibility", () => assert.deepEqual(parseBackup(JSON.stringify([base])),[base]));
test("rejects malformed, unknown, or partially invalid backups", () => {
 assert.throws(()=>parseBackup("{"),SyntaxError);
 assert.throws(()=>parseBackup(JSON.stringify({format:"other",version:1,aliases:[]})),/non reconnu/);
 assert.throws(()=>parseBackup(JSON.stringify({format:"APA-LOCAL-BACKUP",version:1,aliases:[base,{id:"bad"}]})),/invalides/);
});
test("merges by stable ID and updates matching records", () => {
 const other={...base,id:"id-2",label:"other-ef45",name:"Other",createdAt:"2026-10-02T12:00:00.000Z"};
 const changed={...base,notes:"updated notes"}; const merged=mergeImportedAliases([base,other],[changed]);
 assert.equal(merged.length,2); assert.equal(merged.find(x=>x.id==="id-1").notes,"updated notes"); assert.equal(merged[0].id,"id-2");
});
test("updates alias details while preserving identity and creation date", () => {
 const changed=updateAlias([base],base.id,{name:"New name",site:"Another service",notes:"updated"})[0];
 assert.equal(changed.name,"New name"); assert.equal(changed.site,"Another service"); assert.equal(changed.notes,"updated");
 assert.equal(changed.id,base.id); assert.equal(changed.label,base.label); assert.equal(changed.createdAt,base.createdAt); assert.ok(changed.updatedAt);
});
test("does not change records when unknown ID is edited", () => assert.deepEqual(updateAlias([base],"missing",{name:"changed"}),[base]));
test("does not serialize invalid alias data", () => assert.throws(()=>serializeAliases([{...base,name:""}]),/invalide/));

test("prototype page connects the module and all requested controls", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  for (const id of ["alias-site", "alias-notes", "export-backup", "import-backup", "backup-file", "save-alias", "identity-form", "identity-pseudonym", "identity-bio", "identity-github", "identity-website"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  for (const handler of ["parseBackup", "serializeAliases", "updateAlias", "mergeImportedAliases", "persistIdentity", "parseStoredIdentity"]) {
    assert.match(app, new RegExp("\\b" + handler + "\\b"));
  }
  assert.match(html, /Les noms enregistrés ici servent au classement : ce ne sont pas des adresses e-mail fonctionnelles/i);
});
