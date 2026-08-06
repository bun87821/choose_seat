import assert from "node:assert/strict";
import test from "node:test";

import {
  lunchTables,
  LUNCH_TOTAL_SEATS,
} from "../lib/lunch-tables.ts";

test("R05 is a four-person table and the lunch plan has 191 seats", () => {
  const r05 = lunchTables.find((table) => table.id === "R05");

  assert.ok(r05, "R05 should exist");
  assert.equal(r05.capacity, 4);
  assert.equal(LUNCH_TOTAL_SEATS, 191);
});
