"use client";

import {
  buildBaseballPrintSections,
  type BaseballPrintReservation,
} from "@/lib/print-layout";
import {
  formatTaipeiTimestamp,
  PrintToolbar,
  usePrintReservations,
} from "../print-client";

export default function BaseballPrintPage() {
  const { reservations, loading, error, reload } =
    usePrintReservations<BaseballPrintReservation>("/api/reservations");
  const sections = buildBaseballPrintSections(reservations);

  return (
    <main className="print-app">
      <PrintToolbar loading={loading} error={error} onRetry={reload} />
      {!loading && !error && (
        <article className="print-sheet baseball-print-sheet">
          <header className="print-header">
            <div>
              <p>TSMC ISDD-01｜0807 員工旅遊</p>
              <h1>新莊棒球場座位表</h1>
            </div>
            <div className="print-summary">
              <strong>{reservations.length} / 71</strong>
              <span>已安排席次</span>
              <small>產生時間 {formatTaipeiTimestamp(new Date())}</small>
            </div>
          </header>

          <div className="baseball-sections">
            {sections.map((section) => (
              <section className="baseball-section" key={section.id}>
                <h2>{section.id} 區</h2>
                <div className="baseball-rows">
                  {section.rows.map((row) => (
                    <div className="baseball-seat-line" key={row.number}>
                      <b>{row.number} 排</b>
                      <div className="baseball-seat-grid">
                        {row.seats.map((seat) => (
                          <div
                            className={`print-seat ${seat.name ? "occupied" : "empty"}`}
                            key={seat.key}
                          >
                            <strong>{seat.number} 號</strong>
                            <span>{seat.name || "空"}</span>
                            <small>{seat.note || "　"}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <footer className="print-footer">
            空白座位代表尚未安排；現場異動請手寫註記後再回系統更新
          </footer>
        </article>
      )}
    </main>
  );
}
