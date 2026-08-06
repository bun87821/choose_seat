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
  assert.match(css, /\.print-sheet\s*{[^}]*height:\s*192mm;/s);
  assert.match(css, /html, body\s*{[^}]*min-height:\s*0;/s);
  assert.match(
    css,
    /\.lunch-table-grid\s*{[^}]*grid-template-columns:\s*repeat\(5,/s,
  );
  assert.match(
    css,
    /\.lunch-table-grid\s*{[^}]*grid-template-rows:\s*repeat\(9,/s,
  );
  assert.match(
    css,
    /\.lunch-seat-grid\s*{[^}]*grid-template-columns:\s*repeat\(2,/s,
  );
});

test("both seat pickers link to their print views", () => {
  const baseballPicker = source("app/seat-picker.tsx");
  const lunchPicker = source("app/lunch/lunch-picker.tsx");

  assert.match(baseballPicker, /href=["']\/print\/baseball["']/);
  assert.match(lunchPicker, /href=["']\/print\/lunch["']/);
});
