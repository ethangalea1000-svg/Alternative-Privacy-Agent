import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

test("mobile navigation renders fully within a 390px viewport", async () => {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const file = pathname === "/" ? "index.html" : pathname.slice(1);
      if (file.includes("..") || file.startsWith("/")) { res.writeHead(400).end(); return; }
      const content = await readFile(new URL(file, root));
      res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" });
      res.end(content);
    } catch { res.writeHead(404).end("Not found"); }
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto("http://127.0.0.1:" + server.address().port + "/", { waitUntil: "networkidle" });
    const result = await page.evaluate(() => {
      const nav = document.querySelector(".nav-list");
      const links = [...nav.querySelectorAll(".nav-link")];
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        gridColumns: getComputedStyle(nav).gridTemplateColumns.split(" ").length,
        links: links.map((link) => ({ text: link.innerText.replace(/\s+/g, " ").trim(), left: link.getBoundingClientRect().left, right: link.getBoundingClientRect().right, width: link.getBoundingClientRect().width, visible: link.getClientRects().length > 0 && getComputedStyle(link).visibility !== "hidden" }))
      };
    });
    assert.equal(result.viewportWidth, 390);
    assert.equal(result.documentWidth, 390, "page must not scroll horizontally at 390px");
    assert.equal(result.gridColumns, 2, "mobile nav must use a compact two-column layout");
    assert.equal(result.links.length, 4);
    for (const link of result.links) {
      assert.equal(link.visible, true, link.text + " must be visible");
      assert.ok(link.left >= 0, link.text + " must not be clipped on the left");
      assert.ok(link.right <= 390, link.text + " must fit within the 390px viewport");
      assert.ok(link.width > 0, link.text + " must have a visible layout box");
    }
    assert.ok(result.links.some((link) => link.text.includes("Mon pseudonyme")), "Mon pseudonyme link must be rendered");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
