# A4 Seat Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-page A4 landscape print views for the current baseball and lunch seating plans, backed by the latest reservation APIs.

**Architecture:** Extract the baseball seat map into one shared pure-data module, then build pure print-view models for both activities. Two client print routes fetch `cache: "no-store"` data, render compact activity-specific layouts, and call the browser's native print dialog; existing picker pages only gain links to those routes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Node test runner with TypeScript stripping, CSS print media, browser-native printing.

## Global Constraints

- Output is A4 landscape and each activity must fit on exactly one printed page.
- Baseball and lunch remain separate print views and separate PDF/print jobs.
- Print views must fetch current API data and must not modify reservations.
- Chinese names and notes must render through browser fonts; add no PDF-generation dependency.
- Empty seats remain visible.
- Baseball has 71 seats: B1 has 45 and B2 has 26.
- Lunch uses the existing `lunchZones` definition and has 191 seats; R05, R06, and R07 are four-person tables.
- Loading and API failure states must prevent printing stale or blank content.
- Times are formatted in `Asia/Taipei`.

---

### Task 1: Make the baseball seat map a shared source of truth

**Files:**
- Create: `lib/baseball-seats.ts`
- Modify: `app/seat-picker.tsx:10-56`
- Modify: `app/api/reservations/route.ts:14-31`
- Modify: `package.json:6-11`
- Test: `tests/baseball-seats.test.mjs`

**Interfaces:**
- Produces: `BaseballSection`, `BaseballSeat`, `BASEBALL_TOTAL_SEATS`, `baseballSectionSeats`, `validBaseballSeatKeys`, and `baseballSeatLabel()`.
- Consumers: the picker, reservation API, print-model builder, and tests.

- [ ] **Step 1: Write the failing shared-map test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  BASEBALL_TOTAL_SEATS,
  baseballSectionSeats,
  validBaseballSeatKeys,
} from "../lib/baseball-seats.ts";

test("baseball seat map has the approved B1 and B2 ranges", () => {
  assert.equal(BASEBALL_TOTAL_SEATS, 71);
  assert.equal(baseballSectionSeats.B1.length, 45);
  assert.equal(baseballSectionSeats.B2.length, 26);
  assert.equal(validBaseballSeatKeys.has("B1-16-5"), true);
  assert.equal(validBaseballSeatKeys.has("B1-16-14"), true);
  assert.equal(validBaseballSeatKeys.has("B1-16-4"), false);
  assert.equal(validBaseballSeatKeys.has("B1-16-15"), false);
});
```

- [ ] **Step 2: Run the test and confirm the module is missing**

Run: `node --experimental-strip-types --test tests/baseball-seats.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/baseball-seats.ts`.

- [ ] **Step 3: Create the shared seat map**

```ts
export type BaseballSection = "B1" | "B2";

export type BaseballSeat = {
  key: string;
  section: BaseballSection;
  row: number;
  number: number;
};

function seats(section: BaseballSection, rows: Array<[number, number, number]>) {
  return rows.flatMap(([row, first, last]) =>
    Array.from({ length: last - first + 1 }, (_, index) => ({
      key: `${section}-${row}-${first + index}`,
      section,
      row,
      number: first + index,
    })),
  );
}

export const baseballSectionSeats = {
  B1: seats("B1", [[12, 4, 12], [13, 4, 12], [14, 4, 12], [15, 5, 12], [16, 5, 14]]),
  B2: seats("B2", [[14, 7, 12], [15, 5, 14], [16, 5, 14]]),
} satisfies Record<BaseballSection, BaseballSeat[]>;

export const BASEBALL_TOTAL_SEATS =
  baseballSectionSeats.B1.length + baseballSectionSeats.B2.length;

export const validBaseballSeatKeys = new Set(
  Object.values(baseballSectionSeats).flat().map((seat) => seat.key),
);

export function baseballSeatLabel(
  seat: Pick<BaseballSeat, "section" | "row" | "number">,
) {
  return `${seat.section}｜${seat.row} 排 ${seat.number} 號`;
}
```

- [ ] **Step 4: Replace duplicated picker and API constants with imports**

In `app/seat-picker.tsx`, import and use `BASEBALL_TOTAL_SEATS`, `BaseballSeat`, `BaseballSection`, `baseballSectionSeats`, and `baseballSeatLabel`. Remove local `Seat`, `TOTAL_SEATS`, `sectionSeats`, and `seatLabel` definitions without changing UI behavior.

In `app/api/reservations/route.ts`, import `BASEBALL_TOTAL_SEATS` and `validBaseballSeatKeys`. Replace `TOTAL_SEATS` and `validSeats` references with those exports.

- [ ] **Step 5: Add a repeatable test command and run it**

Add to `package.json` scripts:

```json
"test": "node --experimental-strip-types --test tests/*.test.mjs"
```

Run: `npm test`

Expected: the existing R05 test and the new baseball-map test both PASS.

- [ ] **Step 6: Commit the shared map**

```bash
git add package.json app/seat-picker.tsx app/api/reservations/route.ts lib/baseball-seats.ts tests/baseball-seats.test.mjs
git commit -m "Share baseball seat definitions"
```

---

### Task 2: Build complete print-view models

**Files:**
- Create: `lib/print-layout.ts`
- Test: `tests/print-layout.test.mjs`

**Interfaces:**
- Consumes: `baseballSectionSeats`, `lunchZones`, and `validLunchSeatKeys`.
- Produces: `BaseballPrintReservation`, `LunchPrintReservation`, `buildBaseballPrintSections()`, `buildLunchPrintZones()`, and `findOrphanLunchReservations()`.

- [ ] **Step 1: Write failing model tests for occupied and empty seats**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBaseballPrintSections,
  buildLunchPrintZones,
  findOrphanLunchReservations,
} from "../lib/print-layout.ts";

test("baseball print model keeps all 71 seats and fills reservations", () => {
  const sections = buildBaseballPrintSections([
    { seatKey: "B1-12-4", section: "B1", row: 12, number: 4, name: "王小明", note: "ISDD-01", createdAt: "2026-08-06T00:00:00Z" },
  ]);
  const seats = sections.flatMap((section) => section.rows.flatMap((row) => row.seats));
  assert.equal(seats.length, 71);
  assert.equal(seats.find((seat) => seat.key === "B1-12-4")?.name, "王小明");
  assert.equal(seats.find((seat) => seat.key === "B1-12-5")?.name, "");
});

test("lunch print model keeps all 191 seats and reports removed seats", () => {
  const reservations = [
    { seatKey: "R05-1", tableId: "R05", seatNumber: 1, name: "王小明", note: "ISDD-01", createdAt: "2026-08-06T00:00:00Z" },
    { seatKey: "R05-5", tableId: "R05", seatNumber: 5, name: "舊資料", note: "", createdAt: "2026-08-06T00:00:00Z" },
  ];
  const zones = buildLunchPrintZones(reservations);
  const seats = zones.flatMap((zone) => zone.tables.flatMap((table) => table.seats));
  assert.equal(seats.length, 191);
  assert.equal(seats.find((seat) => seat.key === "R05-1")?.name, "王小明");
  assert.deepEqual(findOrphanLunchReservations(reservations).map((item) => item.seatKey), ["R05-5"]);
});
```

- [ ] **Step 2: Run the model tests and confirm the module is missing**

Run: `node --experimental-strip-types --test tests/print-layout.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `lib/print-layout.ts`.

- [ ] **Step 3: Implement pure view-model builders**

Define reservation types matching the two GET API payloads. Map every approved seat to `{ key, number, name, note }`, using empty strings when no reservation exists. Group baseball seats by section and row. Flatten each lunch zone's groups into ordered table objects containing `id`, `capacity`, and every valid seat. Implement orphan detection with `validLunchSeatKeys`.

The public signatures must be:

```ts
export function buildBaseballPrintSections(
  reservations: BaseballPrintReservation[],
): Array<{ id: BaseballSection; rows: Array<{ number: number; seats: PrintSeat[] }> }>;

export function buildLunchPrintZones(
  reservations: LunchPrintReservation[],
): Array<{ id: "R" | "B"; label: string; tables: Array<{ id: string; capacity: number; seats: PrintSeat[] }> }>;

export function findOrphanLunchReservations(
  reservations: LunchPrintReservation[],
): LunchPrintReservation[];
```

- [ ] **Step 4: Run all model tests**

Run: `npm test`

Expected: all seat-map and print-model tests PASS.

- [ ] **Step 5: Commit the model layer**

```bash
git add lib/print-layout.ts tests/print-layout.test.mjs
git commit -m "Build printable seat models"
```

---

### Task 3: Add the two A4 print routes

**Files:**
- Create: `app/print/layout.tsx`
- Create: `app/print/print-client.tsx`
- Create: `app/print/print.css`
- Create: `app/print/baseball/page.tsx`
- Create: `app/print/lunch/page.tsx`

**Interfaces:**
- Consumes: the two GET APIs and Task 2 print-model builders.
- Produces: `/print/baseball` and `/print/lunch`, plus reusable `usePrintReservations()`, `PrintToolbar`, and `formatTaipeiTimestamp()`.

- [ ] **Step 1: Add a failing source-contract test for print routes**

Create `tests/print-routes.test.mjs` that reads the route source files and asserts both endpoints, `cache: "no-store"`, `window.print()`, and `@page { size: A4 landscape; }` are present. The test must fail first because the route files do not exist.

- [ ] **Step 2: Create the print layout and data hook**

`app/print/layout.tsx` imports `./print.css` and returns its children unchanged.

`app/print/print-client.tsx` exports:

```ts
export function usePrintReservations<T>(endpoint: string): {
  reservations: T[];
  loading: boolean;
  error: string;
  reload: () => void;
};

export function formatTaipeiTimestamp(date: Date): string;

export function PrintToolbar(props: {
  loading: boolean;
  error: string;
  onRetry: () => void;
}): React.ReactNode;
```

The hook fetches `{ reservations: T[] }` with `cache: "no-store"`. `PrintToolbar` shows loading, retry on error, and only shows the print button after successful loading.

- [ ] **Step 3: Implement the baseball page**

Mark the page as a client component. Fetch `/api/reservations`, call `buildBaseballPrintSections()`, and render B1 then B2. Each row renders fixed-width seat cells containing seat number, name or `空`, and note when present. Show `reservations.length / 71` and the Taipei timestamp.

- [ ] **Step 4: Implement the lunch page**

Mark the page as a client component. Fetch `/api/lunch-reservations`, call `buildLunchPrintZones()`, and render zones in approved source order. Render all 45 tables in a three-column grid; each table card shows table ID, capacity, and every seat token. Show `reservations.length / 191`, the Taipei timestamp, and an orphan warning when `findOrphanLunchReservations()` is non-empty.

- [ ] **Step 5: Add A4 print CSS**

Use:

```css
@page { size: A4 landscape; margin: 8mm; }
@media print {
  html, body { width: 297mm; min-height: 210mm; background: white; }
  .print-toolbar { display: none !important; }
  .print-sheet { width: 281mm; height: 194mm; overflow: hidden; box-shadow: none; }
}
```

Scope all other styles beneath `.print-app`. Keep print text at or above 6.5pt, use high-contrast black/gray borders, prevent table cards and seat rows from splitting, and use `print-color-adjust: exact`.

- [ ] **Step 6: Run route contract tests and all unit tests**

Run: `npm test`

Expected: all tests PASS, including endpoint, print-call, and A4 CSS contracts.

- [ ] **Step 7: Commit the print routes**

```bash
git add app/print tests/print-routes.test.mjs
git commit -m "Add A4 seat print views"
```

---

### Task 4: Add print entry points to both picker pages

**Files:**
- Modify: `app/seat-picker.tsx:273-287`
- Modify: `app/lunch/lunch-picker.tsx:869-884`
- Modify: `app/globals.css`
- Test: `tests/print-routes.test.mjs`

**Interfaces:**
- Consumes: `/print/baseball` and `/print/lunch` from Task 3.
- Produces: user-facing links labeled `列印 A4 座位表`.

- [ ] **Step 1: Extend the source-contract test and watch it fail**

Assert `app/seat-picker.tsx` contains `href="/print/baseball"` and `app/lunch/lunch-picker.tsx` contains `href="/print/lunch"`.

Run: `node --experimental-strip-types --test tests/print-routes.test.mjs`

Expected: FAIL because neither picker contains the link yet.

- [ ] **Step 2: Add visible links beside the live seat counts**

Use Next `Link` with `target="_blank"` and `rel="noopener noreferrer"`. Give both links class `print-link` and exact copy `列印 A4 座位表`.

- [ ] **Step 3: Style the entry points**

Add a compact outlined `.print-link` style that remains readable on desktop and wraps below the status text on narrow screens. Do not change picker behavior or existing labels.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit the entry points**

```bash
git add app/seat-picker.tsx app/lunch/lunch-picker.tsx app/globals.css tests/print-routes.test.mjs
git commit -m "Link seat pickers to print views"
```

---

### Task 5: Verify A4 output, build, and publish

**Files:**
- Modify only files required by defects found during verification.
- Temporary output: `tmp/pdfs/baseball-seat-list.pdf`, `tmp/pdfs/lunch-seat-list.pdf`, and rendered PNGs; do not commit these files.

**Interfaces:**
- Consumes: completed print routes and current API payload shapes.
- Produces: verified code on GitHub `main`.

- [ ] **Step 1: Run fresh automated verification**

```bash
npm test
npm run lint
DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run build
git diff --check
```

Expected: all commands exit 0. The dummy `DATABASE_URL` is format-only and must not be used for live API requests.

- [ ] **Step 2: Start a local production server behind a read-only fixture proxy**

Start the built app without connecting to production:

```bash
DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build PORT=3100 npm start
```

Create `/tmp/choose-seat-print-proxy.mjs` as a disposable QA file:

```js
import http from "node:http";
import { pathToFileURL } from "node:url";

const root = process.env.PRINT_REPO_ROOT;
if (!root) throw new Error("PRINT_REPO_ROOT is required");

const { baseballSectionSeats } = await import(
  pathToFileURL(`${root}/lib/baseball-seats.ts`).href
);
const { lunchTables } = await import(
  pathToFileURL(`${root}/lib/lunch-tables.ts`).href
);

const label = (index) => `測試姓名 ${String(index + 1).padStart(2, "0")}`;
const note = (index) => (index % 2 === 0 ? "ISDD-01" : "IE");

const baseballReservations = Object.values(baseballSectionSeats)
  .flat()
  .map((seat, index) => ({
    seatKey: seat.key,
    section: seat.section,
    row: seat.row,
    number: seat.number,
    name: label(index),
    note: note(index),
    createdAt: "2026-08-06T12:00:00.000Z",
  }));

const lunchReservations = lunchTables.flatMap((table) =>
  Array.from({ length: table.capacity }, (_, offset) => ({
    seatKey: `${table.id}-${offset + 1}`,
    tableId: table.id,
    seatNumber: offset + 1,
  })),
).map((seat, index) => ({
  ...seat,
  name: label(index),
  note: note(index),
  createdAt: "2026-08-06T12:00:00.000Z",
}));

const json = (response, reservations) => {
  const body = JSON.stringify({ reservations });
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
};

http.createServer(async (request, response) => {
  try {
    if (request.url === "/api/reservations") {
      json(response, baseballReservations);
      return;
    }
    if (request.url === "/api/lunch-reservations") {
      json(response, lunchReservations);
      return;
    }
    const upstream = await fetch(`http://127.0.0.1:3100${request.url}`);
    const body = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
    response.end(body);
  } catch (error) {
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "proxy failed");
  }
}).listen(3200, "127.0.0.1");
```

Start it with:

```bash
PRINT_REPO_ROOT="$PWD" node --experimental-strip-types /tmp/choose-seat-print-proxy.mjs
```

This proxy is read-only and never forwards API requests to PostgreSQL. Open `http://127.0.0.1:3200/print/baseball` and `http://127.0.0.1:3200/print/lunch`; verify the control state, headers, counts, and densely filled worst-case layout. Stop both local processes after QA.

- [ ] **Step 3: Produce PDF QA artifacts**

Use Chrome's headless print-to-PDF support against the fixture proxy:

```bash
mkdir -p tmp/pdfs
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf=tmp/pdfs/baseball-seat-list.pdf http://127.0.0.1:3200/print/baseball
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf=tmp/pdfs/lunch-seat-list.pdf http://127.0.0.1:3200/print/lunch
```

Then run:

```bash
pdfinfo tmp/pdfs/baseball-seat-list.pdf
pdfinfo tmp/pdfs/lunch-seat-list.pdf
pdftoppm -png tmp/pdfs/baseball-seat-list.pdf tmp/pdfs/baseball-seat-list
pdftoppm -png tmp/pdfs/lunch-seat-list.pdf tmp/pdfs/lunch-seat-list
```

Expected: `Pages: 1` for each PDF.

- [ ] **Step 4: Inspect both rendered PNGs**

Confirm no clipped cards, overlapping names, black-square glyphs, missing seats, unreadably small text, or accidental toolbar content. If any defect exists, adjust print CSS, regenerate both PDFs, and inspect again.

- [ ] **Step 5: Verify the final diff and push**

```bash
git status -sb
git diff origin/main...HEAD --check
git log --oneline origin/main..HEAD
git push origin main
git ls-remote origin refs/heads/main
```

Expected: the remote `main` SHA equals local `HEAD`.
