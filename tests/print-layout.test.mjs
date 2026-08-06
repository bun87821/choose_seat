import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBaseballPrintSections,
  buildLunchPrintZones,
  findOrphanLunchReservations,
} from "../lib/print-layout.ts";

test("baseball print model keeps all 71 seats and fills reservations", () => {
  const sections = buildBaseballPrintSections([
    {
      seatKey: "B1-12-4",
      section: "B1",
      row: 12,
      number: 4,
      name: "王小明",
      note: "ISDD-01",
      createdAt: "2026-08-06T00:00:00Z",
    },
  ]);
  const seats = sections.flatMap((section) =>
    section.rows.flatMap((row) => row.seats),
  );

  assert.equal(seats.length, 71);
  assert.equal(seats.find((seat) => seat.key === "B1-12-4")?.name, "王小明");
  assert.equal(seats.find((seat) => seat.key === "B1-12-5")?.name, "");
});

test("lunch print model keeps all 191 seats and reports removed seats", () => {
  const reservations = [
    {
      seatKey: "R05-1",
      tableId: "R05",
      seatNumber: 1,
      name: "王小明",
      note: "ISDD-01",
      createdAt: "2026-08-06T00:00:00Z",
    },
    {
      seatKey: "R05-5",
      tableId: "R05",
      seatNumber: 5,
      name: "舊資料",
      note: "",
      createdAt: "2026-08-06T00:00:00Z",
    },
  ];
  const zones = buildLunchPrintZones(reservations);
  const seats = zones.flatMap((zone) =>
    zone.tables.flatMap((table) => table.seats),
  );

  assert.equal(seats.length, 191);
  assert.equal(seats.find((seat) => seat.key === "R05-1")?.name, "王小明");
  assert.deepEqual(
    findOrphanLunchReservations(reservations).map((item) => item.seatKey),
    ["R05-5"],
  );
});
