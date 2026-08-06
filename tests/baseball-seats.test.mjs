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
