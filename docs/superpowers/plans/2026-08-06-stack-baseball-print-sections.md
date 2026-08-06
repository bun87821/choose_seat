# Stack Baseball Print Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將棒球 A4 座位表由左右分欄改為 B1 在上、B2 在下，讓兩區都使用完整頁寬且維持單頁列印。

**Architecture:** 不變更 React 結構或座位資料，只修改列印頁的 CSS Grid。外層區塊改為上下兩列並按 B1、B2 排數使用 5：3 高度，既有區內排數規則繼續讓每一排取得相同高度。

**Tech Stack:** Next.js 16、React、CSS Grid、Node.js test runner、Chromium 列印 PDF

## Global Constraints

- B1 必須在上方，B2 必須在下方。
- B1 與 B2 都必須使用完整 A4 橫式頁面寬度。
- 兩區高度必須按 5：3 分配，使八排座位高度一致。
- 棒球座位總數維持 71，不修改 API、選位或資料庫邏輯。
- 棒球座位表必須維持單張 A4 橫式，內容不得重疊或裁切。

---

### Task 1: 將棒球列印區塊改為上下排列

**Files:**
- Modify: `tests/print-routes.test.mjs`
- Modify: `app/print/print.css`

**Interfaces:**
- Consumes: `app/print/baseball/page.tsx` 依序輸出的 `.baseball-section`（B1、B2）。
- Produces: `.baseball-sections` 的上下兩列版面，以及 B1／B2 的 5：3 高度配置。

- [ ] **Step 1: Write the failing layout test**

在 `print stylesheet declares one-page A4 landscape output` 測試加入：

```js
assert.match(
  css,
  /\.baseball-sections\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
);
assert.match(
  css,
  /\.baseball-sections\s*{[^}]*grid-template-rows:\s*5fr\s+3fr;/s,
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --test-name-pattern="print stylesheet declares one-page A4 landscape output"`

Expected: FAIL because `.baseball-sections` still declares `grid-template-columns: 5fr 3fr` and has no `grid-template-rows: 5fr 3fr`.

- [ ] **Step 3: Implement the minimal CSS change**

Update `app/print/print.css`:

```css
.baseball-sections {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: 5fr 3fr;
  gap: 2mm;
  padding: 2.5mm 0;
  min-height: 0;
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test`

Expected: all tests PASS, including the new stacked-layout assertions.

- [ ] **Step 5: Generate and inspect the final PDF**

Run the production app with filled baseball fixture data, print `/print/baseball` through Chromium to `tmp/pdfs/baseball-seat-list.pdf`, and run:

```bash
pdfinfo tmp/pdfs/baseball-seat-list.pdf | rg '^(Pages|Page size)'
```

Expected: `Pages: 1` and A4 page size. Render the PDF to PNG and visually confirm B1 is above B2, both use full width, and no names, notes, borders, or footer are clipped.

- [ ] **Step 6: Run final project verification**

Run:

```bash
npm test
npm run lint
DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run build
git diff --check
```

Expected: all commands exit with status 0.

- [ ] **Step 7: Commit the implementation**

```bash
git add tests/print-routes.test.mjs app/print/print.css
git commit -m "Stack baseball print sections"
```

