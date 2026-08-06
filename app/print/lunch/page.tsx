"use client";

import {
  buildLunchPrintZones,
  findOrphanLunchReservations,
  type LunchPrintReservation,
} from "@/lib/print-layout";
import {
  formatTaipeiTimestamp,
  PrintToolbar,
  usePrintReservations,
} from "../print-client";

export default function LunchPrintPage() {
  const { reservations, loading, error, reload } =
    usePrintReservations<LunchPrintReservation>("/api/lunch-reservations");
  const zones = buildLunchPrintZones(reservations);
  const orphans = findOrphanLunchReservations(reservations);
  const seatedCount = reservations.length - orphans.length;

  return (
    <main className="print-app">
      <PrintToolbar loading={loading} error={error} onRetry={reload} />
      {!loading && !error && (
        <article className="print-sheet lunch-print-sheet">
          <header className="print-header">
            <div>
              <p>TSMC ISDD-01｜0807 員工旅遊</p>
              <h1>饗 A JOY 午餐座位表</h1>
            </div>
            <div className="print-summary">
              <strong>{seatedCount} / 191</strong>
              <span>已安排席次</span>
              <small>產生時間 {formatTaipeiTimestamp(new Date())}</small>
            </div>
          </header>

          {orphans.length > 0 && (
            <div className="print-warning">
              ⚠ 尚待重新安排：
              {orphans
                .map(
                  (reservation) =>
                    `${reservation.name}（${reservation.tableId}-${reservation.seatNumber}）`,
                )
                .join("、")}
            </div>
          )}

          <div className="lunch-table-grid">
            {zones.flatMap((zone) =>
              zone.tables.map((table) => (
                <section className="lunch-table-card" key={table.id}>
                  <header>
                    <strong>{table.id}</strong>
                    <span>{zone.label}・{table.capacity} 人桌</span>
                  </header>
                  <div className="lunch-seat-grid">
                    {table.seats.map((seat) => (
                      <div
                        className={`lunch-print-seat ${seat.name ? "occupied" : "empty"}`}
                        key={seat.key}
                      >
                        <b>{seat.number}</b>
                        <span>{seat.name || "空"}</span>
                        <small>{seat.note || "　"}</small>
                      </div>
                    ))}
                  </div>
                </section>
              )),
            )}
          </div>

          <footer className="print-footer">
            共 45 桌、191 位；R05、R06、R07 為 4 人桌
          </footer>
        </article>
      )}
    </main>
  );
}
