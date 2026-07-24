"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Reservation = {
  seatKey: string;
  section: "B1" | "B2";
  row: number;
  number: number;
  name: string;
  note: string;
  isMine: boolean;
  createdAt: string;
};

type Seat = {
  key: string;
  section: "B1" | "B2";
  row: number;
  number: number;
};

const sectionSeats: Record<"B1" | "B2", Seat[]> = {
  B1: [12, 13, 14, 15, 16].flatMap((row) =>
    Array.from({ length: 9 }, (_, index) => ({
      key: `B1-${row}-${index + 4}`,
      section: "B1" as const,
      row,
      number: index + 4,
    })),
  ),
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

function getReservationKey() {
  const stored = window.localStorage.getItem("baseball-reservation-key");
  if (stored) return stored;
  const key =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem("baseball-reservation-key", key);
  return key;
}

function seatLabel(seat: Pick<Seat, "section" | "row" | "number">) {
  return `${seat.section}｜${seat.row} 排 ${seat.number} 號`;
}

export default function SeatPicker() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);
  const [reservationKey] = useState(() =>
    typeof window === "undefined" ? "" : getReservationKey(),
  );
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [activeSection, setActiveSection] = useState<"B1" | "B2">("B1");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showList, setShowList] = useState(false);

  const loadReservations = useCallback(async (quiet = false) => {
    try {
      const key = window.localStorage.getItem("baseball-reservation-key") ?? "";
      const response = await fetch(
        `/api/reservations?reservationKey=${encodeURIComponent(key)}`,
        { cache: "no-store" },
      );
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

  const myReservations = reservations.filter((reservation) => reservation.isMine);
  const myReservation = myReservations[0];
  const availableCount = 71 - reservations.length;
  const effectiveName = myReservation?.name ?? name;
  const effectiveNote = myReservation?.note ?? note;

  function toggleSeat(seat: Seat) {
    setSelectedSeats((current) =>
      current.some((item) => item.key === seat.key)
        ? current.filter((item) => item.key !== seat.key)
        : [...current, seat],
    );
  }

  async function reserveSeats() {
    if (!selectedSeats.length || !effectiveName.trim()) {
      setMessage("請先填寫姓名並至少選擇一個座位。");
      return;
    }
    const totalSeats = myReservations.length + selectedSeats.length;
    const confirmed = window.confirm(
      `請確認選擇座位數與報名時人數相符。\n\n目前共選擇 ${totalSeats} 個座位，是否確認？`,
    );
    if (!confirmed) return;

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seats: [
            ...myReservations.map((item) => ({
              key: item.seatKey,
              section: item.section,
              row: item.row,
              number: item.number,
            })),
            ...selectedSeats,
          ],
          name: effectiveName.trim(),
          note: effectiveNote.trim(),
          reservationKey,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "劃位失敗");
      await loadReservations(true);
      setMessage(`劃位成功：本次新增 ${selectedSeats.length} 席，目前共 ${totalSeats} 席`);
      setSelectedSeats([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "劃位失敗，請再試一次。");
      await loadReservations(true);
    } finally {
      setSaving(false);
    }
  }

  async function cancelReservation(reservation: Reservation) {
    if (!window.confirm(`確定取消 ${seatLabel(reservation)} 嗎？`)) return;
    setSaving(true);
    try {
      const response = await fetch("/api/reservations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationKey, seatKey: reservation.seatKey }),
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
        <div className="status-strip">
          <div>
            <span className="live-dot" />
            座位即時更新
          </div>
          <div className="seat-count">
            <strong>{availableCount}</strong> 席可選
            <span>/ 共 71 席</span>
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
              value={effectiveName}
              onChange={(event) => setName(event.target.value)}
              placeholder="請輸入真實姓名"
              maxLength={30}
              disabled={Boolean(myReservation)}
            />
          </label>
          <label>
            <span>部門／備註</span>
            <input
              value={effectiveNote}
              onChange={(event) => setNote(event.target.value)}
              placeholder="選填，例如：竹科"
              maxLength={40}
              disabled={Boolean(myReservation)}
            />
          </label>
        </section>

        {myReservations.length > 0 && (
          <section className="my-seat">
            <div>
              <span>你的座位・共 {myReservations.length} 席</span>
              <div className="my-seat-list">
                {myReservations.map((reservation) => (
                  <div className="my-seat-chip" key={reservation.seatKey}>
                    <strong>{seatLabel(reservation)}</strong>
                    <button
                      onClick={() => cancelReservation(reservation)}
                      disabled={saving}
                      aria-label={`取消 ${seatLabel(reservation)}`}
                    >
                      取消
                    </button>
                  </div>
                ))}
              </div>
              <small>若有攜伴可繼續新增座位，請確認總座位數與報名人數相符。</small>
            </div>
          </section>
        )}

        <section className="picker-card">
          <div className="picker-heading">
            <div>
              <span className="step-number">2</span>
              <div>
                <h2>選擇你的座位</h2>
                <p>可同時選擇多個空位；再次點擊可取消選取</p>
              </div>
            </div>
            <div className="legend">
              <span><i className="seat available" />可選</span>
              <span><i className="seat selected" />已選</span>
              <span><i className="seat occupied" />已有人</span>
            </div>
          </div>

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
                      const mine = reservation?.isMine;
                      const selected = selectedSeats.some((item) => item.key === seat.key);
                      return (
                        <button
                          key={seat.key}
                          className={`seat-button ${reservation ? "occupied" : ""} ${mine ? "mine" : ""} ${selected ? "selected" : ""}`}
                          disabled={Boolean(reservation && !mine)}
                          onClick={() => toggleSeat(seat)}
                          aria-label={`${seatLabel(seat)}${reservation ? `，${reservation.name} 已選` : "，可選"}`}
                          title={reservation ? `${reservation.name}・${seatLabel(seat)}` : seatLabel(seat)}
                        >
                          <span>{seat.number}</span>
                          {mine && <small>我的</small>}
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
              disabled={!selectedSeats.length || !effectiveName.trim() || saving}
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
                <p>名單每 5 秒自動更新，點座位也能看到姓名。</p>
                <button onClick={downloadCsv} disabled={!reservations.length}>下載 CSV 名單</button>
              </div>
              {reservations.length ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>座位</th><th>姓名</th><th>部門／備註</th></tr></thead>
                    <tbody>
                      {reservations
                        .slice()
                        .sort((a, b) => a.section.localeCompare(b.section) || a.row - b.row || a.number - b.number)
                        .map((item) => (
                          <tr key={item.seatKey}>
                            <td>{seatLabel(item)}</td>
                            <td>{item.name}</td>
                            <td>{item.note || "—"}</td>
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
