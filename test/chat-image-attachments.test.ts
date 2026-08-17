import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("persists chat images behind an authenticated attachment URL", async () => {
  const [database, routes] = await Promise.all([
    readFile(new URL("../src/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/routes.ts", import.meta.url), "utf8"),
  ]);

  assert.match(database, /CREATE TABLE IF NOT EXISTS turn_attachments/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS attachment_uploads/);
  assert.match(routes, /INSERT INTO turn_attachments/);
  assert.match(routes, /app\.post\("\/v1\/attachment-uploads"/);
  assert.match(routes, /attachment_upload_ids/);
  assert.match(routes, /\/v1\/turn-attachments\/:attachmentId/);
  assert.match(routes, /getAuthenticatedUserId\(request\)/);
  assert.match(routes, /private, no-store, max-age=0/);
  assert.match(routes, /attachments: attachmentsByTurn\.get/);
});

test("renders uploaded and historical images as chat media", async () => {
  const [app, styles] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(app, /renderMessageAttachments\(element, messageAttachments\)/);
  assert.match(app, /turn\.attachments \?\? \[\]/);
  assert.match(app, /display_message: text/);
  assert.match(app, /xhr\.upload\.addEventListener\("progress"/);
  assert.match(app, /await Promise\.all\(/);
  assert.match(app, /pendingAttachments\.some\(\(attachment\) => attachment\.loading\)/);
  assert.match(app, /attachment_upload_ids: attachments\.map/);
  assert.match(app, /window\.addEventListener\("pagehide"/);
  assert.match(app, /activeAttachmentRequests\.forEach/);
  assert.match(app, /updateAttachmentProgress\(attachment\)/);
  assert.match(app, /now - lastProgressPaint >= 100/);
  assert.match(app, /window\.sessionStorage\.setItem\(pageStateKey, page\)/);
  assert.doesNotMatch(app, /indexedDB/);
  assert.doesNotMatch(app, /const attachmentSummary/);
  assert.match(styles, /\.message-image-grid/);
  assert.match(styles, /\.message-image-button/);
  assert.match(styles, /\.msg\.user\.has-attachments/);
  assert.match(styles, /\.attachment-upload-progress/);
  assert.match(
    styles,
    /\.message-image-grid\.count-3\s*\{\s*grid-template-columns:\s*repeat\(3/,
  );
  assert.doesNotMatch(styles, /\.message-image-button:hover img/);
  assert.doesNotMatch(
    styles,
    /\.attachment-image-preview:hover img\s*\{[^}]*transform:/s,
  );
});
