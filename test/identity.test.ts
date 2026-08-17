import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeEmailForLookup,
  normalizeLoginIdentifier,
  normalizePhoneForLookup,
} from "../src/identity.js";

test("normalizes supported login identifiers consistently", () => {
  assert.equal(normalizeEmailForLookup(" User@QQ.COM "), "user@qq.com");
  assert.equal(normalizePhoneForLookup("138 0000-1001"), "13800001001");
  assert.equal(normalizeLoginIdentifier(" USERA "), "usera");
  assert.equal(normalizeLoginIdentifier(" 2113950574@QQ.COM "), "2113950574@qq.com");
});

test("profile and mail credential controls are present without exposing a credential", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(html, /id="accountMenu"/);
  assert.match(html, /id="profileEmail"/);
  assert.match(html, /id="profilePhone"/);
  assert.match(html, /id="scheduleSenderAuthCode"[^>]*type="password"/s);
  assert.match(script, /sender_auth_code/);
  assert.doesNotMatch(script, /SMTP_AUTH_CODE/);
});

test("daily email templates require password step-up before schedule creation", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const routes = await readFile(new URL("../src/routes.ts", import.meta.url), "utf8");
  assert.match(html, /id="stepUpPassword"[^>]*type="password"/s);
  assert.match(script, /template\.key === "daily-email-report"/);
  assert.match(script, /purpose: "create_daily_email_schedule"/);
  assert.match(script, /payload\.reauth_token = emailScheduleReauthToken/);
  assert.match(routes, /app\.post\("\/v1\/auth\/step-up"/);
  assert.match(routes, /consumeEmailScheduleStepUpToken/);
  assert.match(routes, /redis\.call\('del', KEYS\[1\]\)/);
});
