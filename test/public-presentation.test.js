import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("public checklist uses neutral, precise privacy wording", () => {
  assert.match(html, /Ne pas publier de détails personnels précis : lieu fréquenté, ville ou âge exact\./);
  assert.doesNotMatch(html, /mon collège, ma ville ou mon âge exact/i);
  assert.match(html, /REPÈRES DE CONFIDENTIALITÉ/);
});

test("static interface icons use inline SVG with stable names", () => {
  for (const name of ["dashboard", "aliases", "identity", "privacy", "pause", "arrow-up-right", "plus", "search", "close"]) {
    assert.match(html, new RegExp(`data-icon="${name}"`), `missing inline SVG icon: ${name}`);
  }
  assert.match(html, /<svg class="icon-svg"/);
  assert.match(css, /\.icon-svg\{[^}]*stroke:currentColor/);
});

test("alias cards and identity links render SVG icons instead of fragile glyphs", () => {
  for (const name of ["shopping-bag", "layers", "external-link", "user-round", "edit", "play", "trash", "arrow-up-right"]) {
    assert.match(app, new RegExp(`["']${name}["']`), `missing dynamic SVG icon: ${name}`);
  }
  assert.match(app, /function svgIcon\(name\)/);
  assert.match(app, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "svg"\)/);
});

test("fragile legacy icon glyphs are absent from public HTML and UI logic", () => {
  const legacyIcons = /[◫⌁✧◇Ⅱ⌕↗⌘✎▶＋]/u;
  assert.doesNotMatch(html, legacyIcons);
  assert.doesNotMatch(app, legacyIcons);
});
