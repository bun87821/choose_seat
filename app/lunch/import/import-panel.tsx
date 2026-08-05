"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  allowsBabySeat,
  LUNCH_TOTAL_SEATS,
  lunchSeatKey,
  lunchSeatLabel,
  lunchTables,
  tableById,
} from "@/lib/lunch-tables";
import {
  assignSeats,
  guestName,
  openSeatsByTable,
  parseRoster,
  sortAssignments,
  type Assignment,
} from "@/lib/seat-assign";

type LunchReservation = {
  seatKey: string;
  tableId: string;
  seatNumber: number;
  name: string;
  note: string;
};

/** 還沒安排到位子的人。 */
type PoolEntry = {
  name: string;
  dept: string;
  partyName: string;
  isGuest: boolean;
};

/** 目前被「拿起來」準備搬動的對象。 */
type Picked =
  | { kind: "seat"; seatKey: string }
  | { kind: "pool"; index: number }
  | null;

function toPool(item: { name: string; dept: string; partyName?: string; isGuest?: boolean }): PoolEntry {
  return {
    name: item.name,
    dept: item.dept,
    partyName: item.partyName ?? item.name,
    isGuest: item.isGuest ?? false,
  };
}

const SAMPLE = `姓名\t課別\t參加人數
王小明\tISDD-01\t1
陳美玲\tISDD-01\t3
林大同\tISDD-02\t2`;

export default function ImportPanel() {
  const [reservations, setReservations] = useState<LunchReservation[]>([]);
  const [raw, setRaw] = useState("");
  const [keepDeptTogether, setKeepDeptTogether] = useState(true);
  const [bigDeptsFirst, setBigDeptsFirst] = useState(true);
  const [preview, setPreview] = useState<Assignment[] | null>(null);
  /** 排不進去或被手動移出的人，等著被放回座位表。 */
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [splitParties, setSplitParties] = useState<string[]>([]);
  const [picked, setPicked] = useState<Picked>(null);
  const [showAllTables, setShowAllTables] = useState(false);
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
    for (const party of parsed.parties) {
      const key = party.dept || "（未填課別）";
      counts.set(key, (counts.get(key) ?? 0) + party.size);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [parsed.parties]);

  const guestCount = parsed.headcount - parsed.parties.length;

  const freeCount = LUNCH_TOTAL_SEATS - reservations.length;

  function buildPreview() {
    if (!parsed.parties.length) {
      setMessage("還沒有讀到任何名單，請先貼上資料。");
      setPreview(null);
      return;
    }
    const open = openSeatsByTable(reservations.map((item) => item.seatKey));
    const result = assignSeats(parsed.parties, open, {
      keepDeptTogether,
      bigDeptsFirst,
    });
    setPreview(result.assignments);
    // 排不下的組拆成個人，方便一個一個手動安排。
    setPool(
      result.unplaced.flatMap((party) =>
        Array.from({ length: party.size }, (_, index) =>
          toPool({
            name: guestName(party.name, index),
            dept: party.dept,
            partyName: party.name,
            isGuest: index > 0,
          }),
        ),
      ),
    );
    setSplitParties(result.splitParties);
    setPicked(null);
    const short = result.unplaced.reduce((total, party) => total + party.size, 0);
    setMessage(
      short
        ? `已排 ${result.assignments.length} 位，還有 ${short} 位排不下（空位只剩 ${freeCount} 個）。可以在下面手動調整。`
        : `已排好 ${result.assignments.length} 位。可以在下面手動調整，確認後再寫入。`,
    );
  }

  /** 點座位表上的人：第一次是拿起來，第二次是放下或互換。 */
  function tapSeat(seatKey: string, occupiedByPlan: boolean) {
    if (!preview) return;
    setMessage("");

    if (!picked) {
      if (occupiedByPlan) setPicked({ kind: "seat", seatKey });
      return;
    }

    if (picked.kind === "seat" && picked.seatKey === seatKey) {
      setPicked(null);
      return;
    }

    const target = tableById.get(seatKey.slice(0, seatKey.lastIndexOf("-")));
    if (!target) return;
    const seatNumber = Number(seatKey.slice(seatKey.lastIndexOf("-") + 1));

    if (picked.kind === "pool") {
      const person = pool[picked.index];
      if (!person) return;
      const displaced = preview.find(
        (item) => lunchSeatKey(item.tableId, item.seatNumber) === seatKey,
      );
      setPreview(
        sortAssignments([
          ...preview.filter((item) => item !== displaced),
          {
            tableId: target.id,
            seatNumber,
            name: person.name,
            dept: person.dept,
            partyName: person.partyName,
            isGuest: person.isGuest,
          },
        ]),
      );
      setPool((current) => [
        ...current.filter((_, index) => index !== picked.index),
        ...(displaced ? [toPool(displaced)] : []),
      ]);
      setPicked(null);
      return;
    }

    // 座位對座位：有人就互換，沒人就搬過去。
    const from = preview.find(
      (item) => lunchSeatKey(item.tableId, item.seatNumber) === picked.seatKey,
    );
    if (!from) {
      setPicked(null);
      return;
    }
    const to = preview.find(
      (item) => lunchSeatKey(item.tableId, item.seatNumber) === seatKey,
    );
    const moved = preview.map((item) => {
      if (item === from) return { ...item, tableId: target.id, seatNumber };
      if (to && item === to) {
        return { ...item, tableId: from.tableId, seatNumber: from.seatNumber };
      }
      return item;
    });
    setPreview(sortAssignments(moved));
    setPicked(null);
  }

  /** 把某個人從座位表移到待安排區。 */
  function removeFromPlan(seatKey: string) {
    if (!preview) return;
    const target = preview.find(
      (item) => lunchSeatKey(item.tableId, item.seatNumber) === seatKey,
    );
    if (!target) return;
    setPreview(preview.filter((item) => item !== target));
    setPool((current) => [...current, toPool(target)]);
    setPicked(null);
    setMessage("");
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
      .map((item) => ({ name: item.name, dept: item.dept, size: 1 }));
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
      unplaced: result.unplaced.flatMap((party) =>
        Array.from({ length: party.size }, (_, index) =>
          toPool({
            name: guestName(party.name, index),
            dept: party.dept,
            partyName: party.name,
            isGuest: index > 0,
          }),
        ),
      ),
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
      setPool((current) => [...current, ...replan.unplaced]);
      setPicked(null);
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
          setPool((current) => [...current, ...retry.unplaced]);
          setPicked(null);
        }
        throw new Error(
          `${data.error ?? "寫入失敗"}${retry ? "已自動改排，請再確認一次預覽。" : ""}`,
        );
      }
      await loadReservations();
      setMessage(`已寫入 ${preview.length} 位。可以回選位頁看結果。`);
      setPreview(null);
      setPool([]);
      setSplitParties([]);
      setPicked(null);
      setRaw("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "寫入失敗，請再試一次。");
    } finally {
      setSaving(false);
    }
  }

  /** 每一桌的每一個位子：已經有人的、這次排進去的、還空著的。 */
  const editorTables = useMemo(() => {
    if (!preview) return [];
    const existing = new Map(reservations.map((item) => [item.seatKey, item]));
    const planned = new Map(
      preview.map((item) => [
        lunchSeatKey(item.tableId, item.seatNumber),
        item,
      ]),
    );
    return lunchTables
      .map((table) => ({
        table,
        seats: Array.from({ length: table.capacity }, (_, index) => {
          const seatNumber = index + 1;
          const seatKey = lunchSeatKey(table.id, seatNumber);
          return {
            seatNumber,
            seatKey,
            existing: existing.get(seatKey),
            planned: planned.get(seatKey),
          };
        }),
      }))
      .map((entry) => ({
        ...entry,
        plannedCount: entry.seats.filter((seat) => seat.planned).length,
      }))
      .filter((entry) => showAllTables || entry.plannedCount > 0);
  }, [preview, reservations, showAllTables]);

  const plannedTableCount = useMemo(
    () => new Set(preview?.map((item) => item.tableId) ?? []).size,
    [preview],
  );

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
                  每行一位同仁，格式為「姓名　課別　參加人數」。人數含本人，
                  <b>攜眷就填 2 以上</b>，省略當作 1 人。可以直接從 Excel
                  複製三欄貼過來，也接受逗號分隔；有標題列會自動略過。
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
              讀到 <b>{parsed.parties.length}</b> 位同仁、共 <b>{parsed.headcount}</b> 人
              {guestCount > 0 && `（含眷屬 ${guestCount} 位）`}
              {parsed.skipped > 0 && `　略過 ${parsed.skipped} 行`}
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
                {parsed.parties.length
                  ? `名單 ${parsed.parties.length} 位同仁・共 ${parsed.headcount} 人・${deptSummary.length} 個課別`
                  : "先在上面貼上名單"}
              </strong>
            </div>
            <button onClick={buildPreview} disabled={!parsed.parties.length}>
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
                  <h2>預覽・微調・寫入</h2>
                  <p>
                    點一個人把他「拿起來」，再點另一個位子就搬過去；點到別人身上就
                    <b>兩人互換</b>。寫入只會填目前的空位，
                    <b>不會動到已經有人的位子</b>
                  </p>
                </div>
              </div>
              <label className="show-all">
                <input
                  type="checkbox"
                  checked={showAllTables}
                  onChange={(event) => setShowAllTables(event.target.checked)}
                />
                <span>顯示全部 45 桌</span>
              </label>
            </div>

            {splitParties.length > 0 && (
              <p className="baby-note">
                <span aria-hidden="true">👨‍👩‍👧</span>
                <span>
                  有 <b>{splitParties.length}</b>{" "}
                  組人數超過單桌容量或剩餘空位不足，同行的人被分到不同桌：
                  {splitParties.slice(0, 20).join("、")}
                  {splitParties.length > 20 && " …"}
                  。可以在下面直接調整。
                </span>
              </p>
            )}

            <div className={`pool-bar ${picked?.kind === "pool" ? "picking" : ""}`}>
              <b>待安排 {pool.length} 位</b>
              {pool.length ? (
                <div className="pool-people">
                  {pool.map((person, index) => (
                    <button
                      key={`${person.name}-${index}`}
                      className={
                        picked?.kind === "pool" && picked.index === index
                          ? "picked"
                          : ""
                      }
                      onClick={() =>
                        setPicked((current) =>
                          current?.kind === "pool" && current.index === index
                            ? null
                            : { kind: "pool", index },
                        )
                      }
                    >
                      {person.name}
                      <small>{person.dept || "—"}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <span className="pool-empty">所有人都排好位子了</span>
              )}
            </div>

            {picked && (
              <p className="picked-hint" role="status">
                已拿起{" "}
                <b>
                  {picked.kind === "pool"
                    ? pool[picked.index]?.name
                    : preview.find(
                        (item) =>
                          lunchSeatKey(item.tableId, item.seatNumber) ===
                          picked.seatKey,
                      )?.name}
                </b>
                ，請點要放的位子；點空位是搬過去，點別人是互換。
                <button onClick={() => setPicked(null)}>取消</button>
              </p>
            )}

            <div className="preview-grid">
              {editorTables.map(({ table, seats, plannedCount }) => (
                <div className="table-card" key={table.id}>
                  <header>
                    <b>
                      {table.id}
                      {allowsBabySeat(table) && (
                        <i className="baby-badge" title="可放嬰兒座椅">
                          🍼
                        </i>
                      )}
                    </b>
                    <span>
                      排 {plannedCount} / {table.capacity} 位
                    </span>
                  </header>
                  <ul className="preview-people">
                    {seats.map((seat) => {
                      if (seat.existing) {
                        return (
                          <li className="taken" key={seat.seatKey}>
                            <b>{seat.seatNumber}</b>
                            <span>🔒 {seat.existing.name}</span>
                            <small>已有人</small>
                          </li>
                        );
                      }
                      const isPicked =
                        picked?.kind === "seat" && picked.seatKey === seat.seatKey;
                      return (
                        <li
                          className={`${seat.planned ? "planned" : "free"} ${isPicked ? "picked" : ""} ${picked && !seat.planned ? "droppable" : ""}`}
                          key={seat.seatKey}
                        >
                          <b>{seat.seatNumber}</b>
                          <button
                            className="seat-tap"
                            onClick={() =>
                              tapSeat(seat.seatKey, Boolean(seat.planned))
                            }
                            title={
                              seat.planned
                                ? `${seat.planned.name}・${lunchSeatLabel(table.id, seat.seatNumber)}`
                                : lunchSeatLabel(table.id, seat.seatNumber)
                            }
                          >
                            {seat.planned ? (
                              <>
                                <span>{seat.planned.name}</span>
                                <small>{seat.planned.dept || "—"}</small>
                              </>
                            ) : (
                              <span className="free-label">
                                {picked ? "放這裡" : "空位"}
                              </span>
                            )}
                          </button>
                          {seat.planned && (
                            <button
                              className="seat-remove"
                              onClick={() => removeFromPlan(seat.seatKey)}
                              title="移到待安排"
                            >
                              ✕
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>

            <div className="confirm-bar">
              <div>
                <span>共 {preview.length} 位、{plannedTableCount} 桌{pool.length ? `・還有 ${pool.length} 位待安排` : ""}</span>
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
