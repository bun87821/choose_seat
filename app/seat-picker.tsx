"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Reservation = {
  seatKey: string;
  section: "B1" | "B2";
  row: number;
  number: number;
  name: string;
  note: string;
  createdAt: string;
};

type Seat = {
  key: string;
  section: "B1" | "B2";
  row: number;
  number: number;
};

const TOTAL_SEATS = 71;

const sectionSeats: Record<"B1" | "B2", Seat[]> = {
  B1: [
    ...[12, 13, 14].flatMap((row) =>
      Array.from({ length: 9 }, (_, index) => ({ row, number: index + 4 })),
    ),
    ...Array.from({ length: 8 }, (_, index) => ({ row: 15, number: index + 5 })),
    ...Array.from({ length: 10 }, (_, index) => ({ row: 16, number: index + 5 })),
  ].map(({ row, number }) => ({
    key: `B1-${row}-${number}`,
    section: "B1" as const,
    row,
    number,
  })),
  B2: [
    ...Array.from({ length: 6 }, (_, index) => ({ row: 14, number: index + 7 })),
    ...[15, 16].flatMap((row) =>
      Array.from({ length: 10 }, (_, index) => ({ row, number: index + 5 })),
    ),
  ].map(({ row, number }) => ({
    key: `B2-${row}-${number}`,
    section: "B2" as const,
    row,
    number,
  })),
};

function seatLabel(seat: Pick<Seat, "section" | "row" | "number">) {
  return `${seat.section}｜${seat.row} 排 ${seat.number} 號`;
}

export default function SeatPicker() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [activeSection, setActiveSection] = useState<"B1" | "B2">("B1");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showList, setShowList] = useState(false);
  const [swapMode, setSwapMode] = useState(false);
  /** 換位模式下「拿起來」的座位。 */
  const [swapFrom, setSwapFrom] = useState<string | null>(null);

  const loadReservations = useCallback(async (quiet = false) => {
    try {
      const response = await fetch("/api/reservations", { cache: "no-store" });
      if (!response.ok) throw new Error("載入失敗");
      const data = (await response.json()) as { reservations: Reservation[] };
      setReservations(data.reservations);
    } catch {
      if (!quiet) setMessage("暫時無法載入座位，請重新整理後再試。");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial remote synchronization; subsequent updates run on the interval.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReservations();
    const timer = window.setInterval(() => void loadReservations(true), 5000);
    return () => window.clearInterval(timer);
  }, [loadReservations]);

  const reservationMap = useMemo(
    () => new Map(reservations.map((reservation) => [reservation.seatKey, reservation])),
    [reservations],
  );

  const availableCount = TOTAL_SEATS - reservations.length;

  function toggleSeat(seat: Seat) {
    setSelectedSeats((current) =>
      current.some((item) => item.key === seat.key)
        ? current.filter((item) => item.key !== seat.key)
        : [...current, seat],
    );
  }

  async function reserveSeats() {
    if (!selectedSeats.length || !name.trim()) {
      setMessage("請先填寫姓名並至少選擇一個座位。");
      return;
    }
    const confirmed = window.confirm(
      `請確認選擇座位數與報名時人數相符。\n\n本次選擇 ${selectedSeats.length} 個座位，是否確認？`,
    );
    if (!confirmed) return;

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seats: selectedSeats,
          name: name.trim(),
          note: note.trim(),
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "劃位失敗");
      await loadReservations(true);
      setMessage(`劃位成功：本次新增 ${selectedSeats.length} 席`);
      setSelectedSeats([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "劃位失敗，請再試一次。");
      await loadReservations(true);
    } finally {
      setSaving(false);
    }
  }

  async function cancelReservation(reservation: Reservation) {
    if (!window.confirm(`確定取消 ${reservation.name} 的 ${seatLabel(reservation)} 嗎？`)) return;
    setSaving(true);
    try {
      const response = await fetch("/api/reservations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seatKey: reservation.seatKey }),
      });
      if (!response.ok) throw new Error("取消失敗");
      await loadReservations(true);
      setMessage(`已取消 ${seatLabel(reservation)}。`);
    } catch {
      setMessage("取消失敗，請稍後再試。");
    } finally {
      setSaving(false);
    }
  }

  /** 換位模式：第一次點是拿起來，第二次點是換過去或互換。 */
  async function tapForSwap(seatKey: string, seat: Seat) {
    setMessage("");
    if (!swapFrom) {
      if (reservationMap.has(seatKey)) setSwapFrom(seatKey);
      else setMessage("請先點一個已經有人的座位，再點要換到哪裡。");
      return;
    }
    if (swapFrom === seatKey) {
      setSwapFrom(null);
      return;
    }

    const source = reservationMap.get(swapFrom);
    if (!source) {
      setSwapFrom(null);
      setMessage("剛剛選的座位已經被取消了，請重新選一次。");
      return;
    }
    const target = reservationMap.get(seatKey);
    const fromLabel = seatLabel(source);
    const toLabel = seatLabel(seat);
    const confirmed = window.confirm(
      target
        ? `要把 ${source.name}（${fromLabel}）和 ${target.name}（${toLabel}）互換嗎？`
        : `要把 ${source.name} 從 ${fromLabel} 換到 ${toLabel} 嗎？`,
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      const response = await fetch("/api/reservations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: swapFrom, to: seatKey }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "換位失敗");
      await loadReservations(true);
      setMessage(
        target
          ? `已將 ${source.name} 與 ${target.name} 互換。`
          : `已把 ${source.name} 換到 ${toLabel}。`,
      );
      setSwapFrom(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "換位失敗，請再試一次。");
      await loadReservations(true);
      setSwapFrom(null);
    } finally {
      setSaving(false);
    }
  }

  function downloadCsv() {
    const rows = [
      ["區域", "排", "號", "姓名", "備註", "劃位時間"],
      ...reservations
        .slice()
        .sort((a, b) => a.section.localeCompare(b.section) || a.row - b.row || a.number - b.number)
        .map((item) => [
          item.section,
          String(item.row),
          String(item.number),
          item.name,
          item.note,
          new Date(item.createdAt).toLocaleString("zh-TW"),
        ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "員工旅遊棒球座位名單.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main>
      <header className="hero">
        <div className="hero-inner">
          <div>
            <p className="eyebrow">2026 EMPLOYEE TRIP</p>
            <h1>一起進場，<span>自己選好位</span></h1>
            <p className="hero-copy">新莊棒球場・富邦悍將 vs 統一獅</p>
          </div>
          <div className="event-card">
            <div><b>8/7</b><span>星期五</span></div>
            <i />
            <div><b>18:30</b><span>比賽開始</span></div>
          </div>
        </div>
      </header>

      <section className="content">
        <nav className="page-nav">
          <span className="current">🏟️ 棒球賽劃位</span>
          <Link href="/lunch">🍽️ 午餐座位</Link>
        </nav>

        <div className="status-strip">
          <div>
            <span className="live-dot" />
            座位即時更新
          </div>
          <div className="seat-count">
            <strong>{availableCount}</strong> 席可選
            <span>/ 共 {TOTAL_SEATS} 席</span>
          </div>
        </div>

        <section className="identity-card">
          <div className="step-number">1</div>
          <div className="identity-copy">
            <h2>先留下你的名字</h2>
            <p>方便婉芃依照座位發放球票</p>
          </div>
          <label>
            <span>姓名 *</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="請輸入真實姓名"
              maxLength={30}
            />
          </label>
          <label>
            <span>部門／備註</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="選填，例如：ISDD-01"
              maxLength={40}
            />
          </label>
        </section>

        <section className="picker-card">
          <div className="picker-heading">
            <div>
              <span className="step-number">2</span>
              <div>
                <h2>選擇你的座位</h2>
                <p>可同時選擇多個空位；已有人座位點擊後可取消，或開啟換位模式互換</p>
              </div>
            </div>
            <div className="legend">
              <span><i className="seat available" />可選</span>
              <span><i className="seat selected" />已選</span>
              <span><i className="seat occupied" />已有人</span>
            </div>
          </div>

          <div className="mode-row">
            <button
              className={`swap-toggle ${swapMode ? "active" : ""}`}
              onClick={() => {
                setSwapMode((value) => !value);
                setSwapFrom(null);
                setMessage("");
              }}
            >
              {swapMode ? "✓ 換位模式（點一換一）" : "換位模式（點一換一）"}
            </button>
          </div>

          {swapMode && (
            <p className="swap-hint" role="status">
              {swapFrom ? (
                <>
                  已拿起 <b>{reservationMap.get(swapFrom)?.name ?? "—"}</b>
                  ，請點要換到的座位：點空位是搬過去，點別人是兩人互換。
                  <button onClick={() => setSwapFrom(null)}>取消</button>
                </>
              ) : (
                <>點一個已經有人的座位把他拿起來，再點另一個座位即可換位。</>
              )}
            </p>
          )}

          <div className="field"><span>球　場　方　向</span></div>

          <div className="section-tabs">
            {(["B1", "B2"] as const).map((section) => {
              const occupied = reservations.filter((item) => item.section === section).length;
              return (
                <button
                  key={section}
                  className={activeSection === section ? "active" : ""}
                  onClick={() => setActiveSection(section)}
                >
                  <b>{section} 區</b>
                  <span>{sectionSeats[section].length - occupied} 席可選</span>
                </button>
              );
            })}
          </div>

          <div className="seat-map" aria-busy={loading}>
            {Array.from(new Set(sectionSeats[activeSection].map((seat) => seat.row))).map((row) => (
              <div className="seat-row" key={row}>
                <b>{row} 排</b>
                <div>
                  {sectionSeats[activeSection]
                    .filter((seat) => seat.row === row)
                    .map((seat) => {
                      const reservation = reservationMap.get(seat.key);
                      const selected = selectedSeats.some((item) => item.key === seat.key);
                      return (
                        <button
                          key={seat.key}
                          className={`seat-button ${reservation ? "occupied" : ""} ${selected ? "selected" : ""} ${swapFrom === seat.key ? "holding" : ""} ${swapMode && swapFrom && swapFrom !== seat.key ? "droppable" : ""}`}
                          disabled={saving}
                          onClick={() =>
                            swapMode
                              ? void tapForSwap(seat.key, seat)
                              : reservation
                                ? void cancelReservation(reservation)
                                : toggleSeat(seat)
                          }
                          aria-label={`${seatLabel(seat)}${reservation ? `，${reservation.name}` : "，可選"}`}
                          title={
                            swapMode
                              ? reservation
                                ? `${reservation.name}・${seatLabel(seat)}・點擊${swapFrom ? "與這位互換" : "拿起來"}`
                                : `${seatLabel(seat)}・${swapFrom ? "點擊換到這裡" : "空位"}`
                              : reservation
                                ? `${reservation.name}・${seatLabel(seat)}`
                                : seatLabel(seat)
                          }
                        >
                          <span>{seat.number}</span>
                          {reservation && <small>{reservation.name}</small>}
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>

          <div className="confirm-bar">
            <div>
              <span>{selectedSeats.length ? `本次新增 ${selectedSeats.length} 席` : "請至少選擇一個空位"}</span>
              <strong>
                {selectedSeats.length
                  ? selectedSeats.map((seat) => seatLabel(seat)).join("、")
                  : "—"}
              </strong>
            </div>
            <button
              onClick={reserveSeats}
              disabled={!selectedSeats.length || !name.trim() || saving}
            >
              {saving ? "處理中…" : `確認選擇 ${selectedSeats.length || ""} 席`}
            </button>
          </div>
          {message && <p className="message" role="status">{message}</p>}
        </section>

        <section className="roster">
          <button className="roster-toggle" onClick={() => setShowList((value) => !value)}>
            <span><b>目前座位名單</b><small>已完成 {reservations.length} 席劃位</small></span>
            <span>{showList ? "收起" : "查看"}　{showList ? "↑" : "↓"}</span>
          </button>
          {showList && (
            <div className="roster-content">
              <div className="roster-actions">
                <p>名單每 5 秒自動更新，所有人都可以取消座位後重新選。</p>
                <button onClick={downloadCsv} disabled={!reservations.length}>下載 CSV 名單</button>
              </div>
              {reservations.length ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>座位</th><th>姓名</th><th>部門／備註</th><th>操作</th></tr></thead>
                    <tbody>
                      {reservations
                        .slice()
                        .sort((a, b) => a.section.localeCompare(b.section) || a.row - b.row || a.number - b.number)
                        .map((item) => (
                          <tr key={item.seatKey}>
                            <td>{seatLabel(item)}</td>
                            <td>{item.name}</td>
                            <td>{item.note || "—"}</td>
                            <td>
                              <button
                                className="table-action"
                                onClick={() => cancelReservation(item)}
                                disabled={saving}
                              >
                                取消
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="empty">目前還沒有人劃位，成為第一位吧！</p>}
            </div>
          )}
        </section>

        <footer>
          <p>票券將於饗 A JOY 用餐時由婉芃發放，領取後請自行妥善保管。</p>
        </footer>
      </section>
    </main>
  );
}
