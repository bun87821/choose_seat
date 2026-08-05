"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  allowsBabySeat,
  LUNCH_TOTAL_SEATS,
  lunchSeatKey,
  tableById,
} from "@/lib/lunch-tables";
import {
  assignSeats,
  openSeatsByTable,
  parseRoster,
  sortAssignments,
  type Assignment,
  type Person,
} from "@/lib/seat-assign";

type LunchReservation = {
  seatKey: string;
  tableId: string;
  seatNumber: number;
  name: string;
  note: string;
};

const SAMPLE = `姓名\t課別
王小明\tISDD-01
陳美玲\tISDD-01
林大同\tISDD-02`;

export default function ImportPanel() {
  const [reservations, setReservations] = useState<LunchReservation[]>([]);
  const [raw, setRaw] = useState("");
  const [keepDeptTogether, setKeepDeptTogether] = useState(true);
  const [bigDeptsFirst, setBigDeptsFirst] = useState(true);
  const [preview, setPreview] = useState<Assignment[] | null>(null);
  const [unplaced, setUnplaced] = useState<Person[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const fetchReservations = useCallback(async () => {
    const response = await fetch("/api/lunch-reservations", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("載入失敗");
    const data = (await response.json()) as {
      reservations: LunchReservation[];
    };
    return data.reservations;
  }, []);

  const loadReservations = useCallback(
    async (quiet = false) => {
      try {
        const latest = await fetchReservations();
        setReservations(latest);
        return latest;
      } catch {
        if (!quiet) setMessage("暫時無法讀取目前座位，請重新整理後再試。");
        return null;
      }
    },
    [fetchReservations],
  );

  useEffect(() => {
    // 座位隨時可能被別人選走，這裡持續同步，預覽才會排在真正的空位上。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReservations();
    const timer = window.setInterval(() => void loadReservations(true), 5000);
    return () => window.clearInterval(timer);
  }, [loadReservations]);

  const parsed = useMemo(() => parseRoster(raw), [raw]);

  const deptSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const person of parsed.people) {
      const key = person.dept || "（未填課別）";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [parsed.people]);

  const freeCount = LUNCH_TOTAL_SEATS - reservations.length;

  function buildPreview() {
    if (!parsed.people.length) {
      setMessage("還沒有讀到任何名單，請先貼上資料。");
      setPreview(null);
      return;
    }
    const open = openSeatsByTable(reservations.map((item) => item.seatKey));
    const result = assignSeats(parsed.people, open, {
      keepDeptTogether,
      bigDeptsFirst,
    });
    setPreview(result.assignments);
    setUnplaced(result.unplaced);
    setMessage(
      result.unplaced.length
        ? `已排 ${result.assignments.length} 位，還有 ${result.unplaced.length} 位排不下（空位只剩 ${freeCount} 個）。`
        : `已排好 ${result.assignments.length} 位，確認後再寫入。`,
    );
  }

  /**
   * 把預覽中「位子已經被別人選走」的人重新排到其他空位，
   * 其餘人的安排維持不動。回傳 null 代表沒有衝突。
   */
  function replanAround(latest: LunchReservation[], current: Assignment[]) {
    const taken = new Set(latest.map((item) => item.seatKey));
    const kept = current.filter(
      (item) => !taken.has(lunchSeatKey(item.tableId, item.seatNumber)),
    );
    const displaced = current
      .filter((item) => taken.has(lunchSeatKey(item.tableId, item.seatNumber)))
      .map((item) => ({ name: item.name, dept: item.dept }));
    if (!displaced.length) return null;

    const used = new Set([
      ...taken,
      ...kept.map((item) => lunchSeatKey(item.tableId, item.seatNumber)),
    ]);
    const result = assignSeats(displaced, openSeatsByTable(used), {
      keepDeptTogether,
      bigDeptsFirst,
    });
    return {
      assignments: sortAssignments([...kept, ...result.assignments]),
      unplaced: result.unplaced,
      displaced: displaced.length,
    };
  }

  async function commit() {
    if (!preview?.length) return;

    // 寫入前再抓一次最新狀況，確定不會動到已經有人的位子。
    const latest = await loadReservations();
    if (!latest) return;
    const replan = replanAround(latest, preview);
    if (replan) {
      setPreview(replan.assignments);
      setUnplaced(replan.unplaced);
      setMessage(
        `這期間有 ${replan.displaced} 個位子被別人選走了，已經自動改排到其他空位，尚未寫入任何資料。請再確認一次預覽。`,
      );
      return;
    }

    const confirmed = window.confirm(
      `要把這 ${preview.length} 位寫入座位嗎？\n\n只會填目前的空位，不會動到已經有人的位子。寫入後大家仍然可以自行換位或換桌。`,
    );
    if (!confirmed) return;

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/lunch-reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: preview.map((item) => ({
            tableId: item.tableId,
            seatNumber: item.seatNumber,
            name: item.name,
            note: item.dept,
          })),
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        conflicts?: string[];
      };
      if (!response.ok) {
        // 伺服器擋下來代表在這一瞬間又有人選走位子，整批都沒寫入。
        const fresh = await loadReservations(true);
        const retry = fresh ? replanAround(fresh, preview) : null;
        if (retry) {
          setPreview(retry.assignments);
          setUnplaced(retry.unplaced);
        }
        throw new Error(
          `${data.error ?? "寫入失敗"}${retry ? "已自動改排，請再確認一次預覽。" : ""}`,
        );
      }
      await loadReservations();
      setMessage(`已寫入 ${preview.length} 位。可以回選位頁看結果。`);
      setPreview(null);
      setUnplaced([]);
      setRaw("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "寫入失敗，請再試一次。");
    } finally {
      setSaving(false);
    }
  }

  const previewByTable = useMemo(() => {
    if (!preview) return [];
    const grouped = new Map<string, Assignment[]>();
    for (const item of preview) {
      const list = grouped.get(item.tableId);
      if (list) list.push(item);
      else grouped.set(item.tableId, [item]);
    }
    return [...grouped.entries()];
  }, [preview]);

  return (
    <main>
      <header className="hero">
        <div className="hero-inner">
          <div>
            <p className="eyebrow">0807 LUNCH · BATCH IMPORT</p>
            <h1>
              批次匯入名單，<span>依課別排位</span>
            </h1>
            <p className="hero-copy">
              貼上名單自動配位，寫入後大家仍可自行換位、換桌
            </p>
          </div>
          <div className="event-card">
            <div>
              <b>{freeCount}</b>
              <span>目前空位</span>
            </div>
            <i />
            <div>
              <b>{reservations.length}</b>
              <span>已入座</span>
            </div>
          </div>
        </div>
      </header>

      <section className="content">
        <nav className="page-nav">
          <Link href="/">🏟️ 棒球賽劃位</Link>
          <Link href="/lunch">🍽️ 午餐座位</Link>
          <span className="current">📋 批次匯入</span>
        </nav>

        <section className="picker-card">
          <div className="picker-heading">
            <div>
              <span className="step-number">1</span>
              <div>
                <h2>貼上名單</h2>
                <p>
                  每行一位，格式為「姓名　課別」。可以直接從 Excel
                  複製兩欄貼過來，也接受逗號分隔；有標題列會自動略過。
                </p>
              </div>
            </div>
          </div>

          <textarea
            className="roster-input"
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            placeholder={SAMPLE}
            rows={12}
            spellCheck={false}
          />

          <div className="parse-summary">
            <span>
              讀到 <b>{parsed.people.length}</b> 位
              {parsed.skipped > 0 && `（略過 ${parsed.skipped} 行）`}
            </span>
            {deptSummary.length > 0 && (
              <span className="dept-chips">
                {deptSummary.map(([dept, count]) => (
                  <i key={dept}>
                    {dept} <b>{count}</b>
                  </i>
                ))}
              </span>
            )}
          </div>
        </section>

        <section className="picker-card">
          <div className="picker-heading">
            <div>
              <span className="step-number">2</span>
              <div>
                <h2>排位規則</h2>
                <p>改了規則要重新產生預覽</p>
              </div>
            </div>
          </div>

          <div className="option-rows">
            <label className="option-row">
              <input
                type="checkbox"
                checked={keepDeptTogether}
                onChange={(event) => setKeepDeptTogether(event.target.checked)}
              />
              <span>
                <b>同課別盡量坐同一桌</b>
                <small>
                  一個課別先找剛好塞得下的桌子；人數超過一桌時，會往座位圖上鄰近的桌子接著排。關掉的話就照名單順序從頭填。
                </small>
              </span>
            </label>
            <label className="option-row">
              <input
                type="checkbox"
                checked={bigDeptsFirst}
                onChange={(event) => setBigDeptsFirst(event.target.checked)}
                disabled={!keepDeptTogether}
              />
              <span>
                <b>人多的課別先挑桌</b>
                <small>
                  人數多的課別優先配到大桌，比較不會被拆散。關掉的話依名單中課別出現的順序排。
                </small>
              </span>
            </label>
          </div>

          <div className="confirm-bar">
            <div>
              <span>目前有 {freeCount} 個空位可以配</span>
              <strong>
                {parsed.people.length
                  ? `名單 ${parsed.people.length} 位・${deptSummary.length} 個課別`
                  : "先在上面貼上名單"}
              </strong>
            </div>
            <button onClick={buildPreview} disabled={!parsed.people.length}>
              產生預覽
            </button>
          </div>
          {message && (
            <p className="message" role="status">
              {message}
            </p>
          )}
        </section>

        {preview && (
          <section className="picker-card">
            <div className="picker-heading">
              <div>
                <span className="step-number">3</span>
                <div>
                  <h2>預覽並寫入</h2>
                  <p>
                    寫入只會填目前的空位，<b>不會動到已經有人的位子</b>
                    ；若預覽期間有位子被選走，會自動改排並請你重新確認
                  </p>
                </div>
              </div>
            </div>

            {unplaced.length > 0 && (
              <p className="baby-note">
                <span aria-hidden="true">⚠️</span>
                <span>
                  有 <b>{unplaced.length}</b> 位排不進去（空位不足）：
                  {unplaced
                    .slice(0, 20)
                    .map((person) => person.name)
                    .join("、")}
                  {unplaced.length > 20 && " …"}
                </span>
              </p>
            )}

            <div className="preview-grid">
              {previewByTable.map(([tableId, list]) => {
                const table = tableById.get(tableId)!;
                return (
                  <div className="table-card" key={tableId}>
                    <header>
                      <b>
                        {tableId}
                        {allowsBabySeat(table) && (
                          <i className="baby-badge" title="可放嬰兒座椅">
                            🍼
                          </i>
                        )}
                      </b>
                      <span>
                        排 {list.length} / {table.capacity} 位
                      </span>
                    </header>
                    <ul className="preview-people">
                      {list.map((item) => (
                        <li key={lunchSeatKey(item.tableId, item.seatNumber)}>
                          <b>{item.seatNumber}</b>
                          <span>{item.name}</span>
                          <small>{item.dept || "—"}</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>

            <div className="confirm-bar">
              <div>
                <span>共 {preview.length} 位、{previewByTable.length} 桌</span>
                <strong>寫入後回選位頁就能看到，大家可以自行換位</strong>
              </div>
              <button onClick={commit} disabled={saving || !preview.length}>
                {saving ? "寫入中…" : `確認寫入 ${preview.length} 位`}
              </button>
            </div>
          </section>
        )}

        <footer>
          <p>
            排位只會填目前的空位。若要重排，請先到
            <Link href="/lunch">午餐座位</Link>
            用多選取消清掉，再回來匯入一次。
          </p>
        </footer>
      </section>
    </main>
  );
}
