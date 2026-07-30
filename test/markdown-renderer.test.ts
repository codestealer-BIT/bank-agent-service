import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("loads local KaTeX assets before the markdown renderer", async () => {
  const html = await readFile(
    path.join(projectRoot, "public", "index.html"),
    "utf8",
  );

  const katexScript = html.indexOf("/vendor/katex/katex.min.js");
  const autoRenderScript = html.indexOf("/vendor/katex/auto-render.min.js");
  const markdownRenderer = html.indexOf("/markdown-renderer.js");

  assert.ok(katexScript >= 0);
  assert.ok(autoRenderScript > katexScript);
  assert.ok(markdownRenderer > autoRenderScript);

  await Promise.all([
    access(path.join(projectRoot, "public", "vendor", "katex", "katex.min.css")),
    access(path.join(projectRoot, "public", "vendor", "katex", "katex.min.js")),
    access(
      path.join(projectRoot, "public", "vendor", "katex", "auto-render.min.js"),
    ),
    access(
      path.join(
        projectRoot,
        "public",
        "vendor",
        "katex",
        "fonts",
        "KaTeX_Main-Regular.woff2",
      ),
    ),
  ]);
});

test("renders common LaTeX delimiters with safe KaTeX settings", async () => {
  const renderer = await readFile(
    path.join(projectRoot, "public", "markdown-renderer.js"),
    "utf8",
  );

  const displayDelimiter = renderer.indexOf(
    '{ left: "$$", right: "$$", display: true }',
  );
  const inlineDelimiter = renderer.indexOf(
    '{ left: "$", right: "$", display: false }',
  );

  assert.ok(displayDelimiter >= 0);
  assert.ok(inlineDelimiter > displayDelimiter);
  assert.match(renderer, /throwOnError:\s*false/);
  assert.match(renderer, /trust:\s*false/);
  assert.match(renderer, /"pre",\s*"code"/);
  assert.match(renderer, /normalizeMathDelimiters/);
  assert.match(renderer, /renderMath\(element,\s*mathOptions\)/);
});
