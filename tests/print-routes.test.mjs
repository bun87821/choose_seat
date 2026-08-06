import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  try {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  } catch {
    return "";
  }
}

test("print routes load current data and expose browser printing", () => {
  const client = source("app/print/print-client.tsx");
  const baseball = source("app/print/baseball/page.tsx");
  const lunch = source("app/print/lunch/page.tsx");

  assert.match(client, /cache:\s*["']no-store["']/);
  assert.match(client, /window\.print\(\)/);
  assert.match(baseball, /["']\/api\/reservations["']/);
  assert.match(lunch, /["']\/api\/lunch-reservations["']/);
});

test("print stylesheet declares one-page A4 landscape output", () => {
  const css = source("app/print/print.css");

  assert.match(css, /@page\s*{[^}]*size:\s*A4 landscape;/s);
  assert.match(css, /\.print-toolbar\s*{[^}]*display:\s*none\s*!important;/s);
  assert.match(css, /\.print-sheet\s*{[^}]*height:\s*194mm;/s);
});
