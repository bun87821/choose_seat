"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  allowsBabySeat,
  babySeatTableIds,
  FLOOR_ASPECT_RATIO,
  floorLandmarks,
  floorTableSize,
  LUNCH_TOTAL_SEATS,
  lunchSeatKey,
  lunchSeatLabel,
  lunchTables,
  lunchZones,
  tableById,
  validLunchSeatKeys,
  zoneOfTable,
  type LunchTable,
} from "@/lib/lunch-tables";
import { formatPlate, isValidPlate, normalizePlate } from "@/lib/plate";
import { guestName, MAX_PARTY_SIZE } from "@/lib/seat-assign";
import {
  askEditPassword,
  handlePasswordRejection,
} from "@/lib/edit-password-client";

type LunchReservation = {
  seatKey: string;
  tableId: string;
  seatNumber: number;
  name: string;
  note: string;
  createdAt: string;
};

type SelectedSeat = {
  seatKey: string;
  tableId: string;
  seatNumber: number;
};

type BoardMessage = {
  id: string;
  name: string;
  body: string;
  createdAt: string;
};

type PlateEntry = {
  plate: string;
  name: string;
  note: string;
  createdAt: string;
};

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function LunchPicker() {
  const [reservations, setReservations] = useState<LunchReservation[]>([]);
  const [plates, setPlates] = useState<PlateEntry[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<SelectedSeat[]>([]);
  const [cancelKeys, setCancelKeys] = useState<string[]>([]);
  const [moveTarget, setMoveTarget] = useState("");
  const [swapMode, setSwapMode] = useState(false);
  /** 換位模式下「拿起來」的位子。 */
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [partySize, setPartySize] = useState(1);
  const [activeZone, setActiveZone] = useState<"R" | "B">("B");
  const [viewMode, setViewMode] = useState<"map" | "list">("list");
  const [openTableId, setOpenTableId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showList, setShowList] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [query, setQuery] = useState("");
  /** 名單只看某個部門／備註；空字串代表全部。 */
  const [deptFilter, setDeptFilter] = useState("");
  /** 從搜尋結果點過去的那個位子，會多一圈強調。 */
  const [foundKey, setFoundKey] = useState<string | null>(null);

  const [messages, setMessages] = useState<BoardMessage[]>([]);
  const [boardName, setBoardName] = useState("");
  const [boardBody, setBoardBody] = useState("");
  const [boardSaving, setBoardSaving] = useState(false);
  const [boardMessage, setBoardMessage] = useState("");

  const [plateName, setPlateName] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [plateNote, setPlateNote] = useState("");
  const [plateSaving, setPlateSaving] = useState(false);
  const [plateMessage, setPlateMessage] = useState("");

  const loadAll = useCallback(async (quiet = false) => {
    try {
      const [seatResponse, plateResponse, boardResponse] = await Promise.all([
        fetch("/api/lunch-reservations", { cache: "no-store" }),
        fetch("/api/parking", { cache: "no-store" }),
        fetch("/api/messages", { cache: "no-store" }),
      ]);
      if (!seatResponse.ok || !plateResponse.ok || !boardResponse.ok)
        throw new Error("載入失敗");
      const seatData = (await seatResponse.json()) as {
        reservations: LunchReservation[];
      };
      const plateData = (await plateResponse.json()) as { plates: PlateEntry[] };
      const boardData = (await boardResponse.json()) as {
        messages: BoardMessage[];
      };
      setReservations(seatData.reservations);
      setPlates(plateData.plates);
      setMessages(boardData.messages);
      // 別人先取消掉的位子就不必留在待取消清單裡。
      const liveKeys = new Set(
        seatData.reservations.map((item) => item.seatKey),
      );
      setCancelKeys((current) => current.filter((key) => liveKeys.has(key)));
    } catch {
      if (!quiet) setMessage("暫時無法載入資料，請重新整理後再試。");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial remote synchronization; subsequent updates run on the interval.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll();
    const timer = window.setInterval(() => void loadAll(true), 5000);
    return () => window.clearInterval(timer);
  }, [loadAll]);

  const reservationMap = useMemo(
    () => new Map(reservations.map((item) => [item.seatKey, item])),
    [reservations],
  );

  const zoneTakenCount = useMemo(() => {
    const counts: Record<"R" | "B", number> = { R: 0, B: 0 };
    for (const item of reservations) {
      const zone = zoneOfTable.get(item.tableId);
      if (zone) counts[zone] += 1;
    }
    return counts;
  }, [reservations]);

  const zoneCapacity = useMemo(() => {
    const counts: Record<"R" | "B", number> = { R: 0, B: 0 };
    for (const zone of lunchZones) {
      for (const group of zone.groups) {
        for (const item of group.tables) counts[zone.id] += item.capacity;
      }
    }
    return counts;
  }, []);

  /** 桌子人數調整後，落在已經不存在的位子上的資料。 */
  const orphanReservations = useMemo(
    () => reservations.filter((item) => !validLunchSeatKeys.has(item.seatKey)),
    [reservations],
  );

  const availableCount =
    LUNCH_TOTAL_SEATS - (reservations.length - orphanReservations.length);

  /** 用姓名或課別找人；空白就不搜尋。 */
  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return reservations
      .filter(
        (item) =>
          item.name.toLowerCase().includes(needle) ||
          item.note.toLowerCase().includes(needle),
      )
      .sort(
        (a, b) =>
          a.tableId.localeCompare(b.tableId) || a.seatNumber - b.seatNumber,
      );
  }, [query, reservations]);

  const matchedKeys = useMemo(
    () => new Set(searchResults.map((item) => item.seatKey)),
    [searchResults],
  );

  const NO_DEPT = "（未填）";

  /** 名單裡出現過的部門／備註與人數，多的排前面。 */
  const deptOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of reservations) {
      const key = item.note.trim() || NO_DEPT;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  }, [reservations]);

  /** 套用篩選後、依桌號排好的名單。 */
  const rosterRows = useMemo(() => {
    return reservations
      .filter(
        (item) =>
          !deptFilter || (item.note.trim() || NO_DEPT) === deptFilter,
      )
      .slice()
      .sort(
        (a, b) =>
          a.tableId.localeCompare(b.tableId) || a.seatNumber - b.seatNumber,
      );
  }, [reservations, deptFilter]);

  const rosterKeys = useMemo(
    () => rosterRows.map((item) => item.seatKey),
    [rosterRows],
  );
  const allRosterChecked =
    rosterKeys.length > 0 && rosterKeys.every((key) => cancelKeys.includes(key));

  /** 跳到某個人的位子：切到他所在的區，捲過去並標記起來。 */
  function goToSeat(reservation: LunchReservation) {
    const zone = zoneOfTable.get(reservation.tableId);
    if (zone) setActiveZone(zone);
    if (viewMode === "map") setOpenTableId(reservation.tableId);
    setFoundKey(reservation.seatKey);
    window.setTimeout(() => {
      document
        .querySelector(`[data-seat="${reservation.seatKey}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  /** 能容納目前選取人數的桌子，換桌下拉選單用。 */
  const moveOptions = useMemo(() => {
    if (!cancelKeys.length) return [];
    const markedByTable = new Map<string, number>();
    for (const key of cancelKeys) {
      const reservation = reservationMap.get(key);
      if (reservation) {
        markedByTable.set(
          reservation.tableId,
          (markedByTable.get(reservation.tableId) ?? 0) + 1,
        );
      }
    }
    const occupiedByTable = new Map<string, number>();
    for (const reservation of reservations) {
      occupiedByTable.set(
        reservation.tableId,
        (occupiedByTable.get(reservation.tableId) ?? 0) + 1,
      );
    }
    return lunchTables
      .map((item) => ({
        item,
        // 選取中的位子搬走之後，這桌實際會空出幾個位子。
        freeAfter:
          item.capacity -
          ((occupiedByTable.get(item.id) ?? 0) - (markedByTable.get(item.id) ?? 0)),
      }))
      .filter(
        ({ item, freeAfter }) =>
          freeAfter >= cancelKeys.length &&
          (markedByTable.get(item.id) ?? 0) < cancelKeys.length,
      );
  }, [cancelKeys, reservationMap, reservations]);

  /** 選取的剛好是某一桌的全部人時，才有「整桌對調」可選。 */
  const wholeTableSelected = useMemo(() => {
    if (!cancelKeys.length) return null;
    const picked = cancelKeys
      .map((key) => reservationMap.get(key))
      .filter((item): item is LunchReservation => Boolean(item));
    const tableIds = new Set(picked.map((item) => item.tableId));
    if (tableIds.size !== 1) return null;
    const tableId = [...tableIds][0];
    const occupants = reservations.filter((item) => item.tableId === tableId);
    return occupants.length === picked.length ? tableId : null;
  }, [cancelKeys, reservationMap, reservations]);

  /** 可以跟目前這桌整批對調的桌子：兩邊的人數都要坐得下對方。 */
  const swapOptions = useMemo(() => {
    if (!wholeTableSelected) return [];
    const source = tableById.get(wholeTableSelected);
    if (!source) return [];
    const occupiedByTable = new Map<string, number>();
    for (const reservation of reservations) {
      occupiedByTable.set(
        reservation.tableId,
        (occupiedByTable.get(reservation.tableId) ?? 0) + 1,
      );
    }
    return lunchTables
      .map((item) => ({ item, people: occupiedByTable.get(item.id) ?? 0 }))
      .filter(
        ({ item, people }) =>
          item.id !== source.id &&
          people > 0 &&
          people <= source.capacity &&
          cancelKeys.length <= item.capacity,
      );
  }, [wholeTableSelected, reservations, cancelKeys.length]);

  const moveTargetValid =
    moveOptions.some(({ item }) => item.id === moveTarget) ||
    swapOptions.some(({ item }) => `swap:${item.id}` === moveTarget);
  const isSwapTarget = moveTarget.startsWith("swap:");

  function toggleSeat(seat: SelectedSeat) {
    setSelectedSeats((current) =>
      current.some((item) => item.seatKey === seat.seatKey)
        ? current.filter((item) => item.seatKey !== seat.seatKey)
        : [...current, seat],
    );
  }

  async function reserveSeats() {
    if (!selectedSeats.length || !name.trim()) {
      setMessage("請先填寫姓名並至少選擇一個位子。");
      return;
    }
    if (selectedSeats.length !== partySize) {
      setMessage(
        `你填的參加人數是 ${partySize} 位，但選了 ${selectedSeats.length} 個位子。請調整成一致再送出。`,
      );
      return;
    }
    const confirmed = window.confirm(
      partySize > 1
        ? `${name.trim()} 共 ${partySize} 位（含眷屬 ${partySize - 1} 位），選了 ${selectedSeats.length} 個位子，是否確認？`
        : `本次選擇 ${selectedSeats.length} 個位子，是否確認？`,
    );
    if (!confirmed) return;

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/lunch-reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: selectedSeats.map((seat, index) => ({
            tableId: seat.tableId,
            seatNumber: seat.seatNumber,
            name: guestName(name.trim(), index),
            note: note.trim(),
          })),
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "選位失敗");
      await loadAll(true);
      setMessage(`選位成功：本次新增 ${selectedSeats.length} 個位子`);
      setSelectedSeats([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "選位失敗，請再試一次。");
      await loadAll(true);
    } finally {
      setSaving(false);
    }
  }

  function toggleCancel(seatKey: string) {
    setCancelKeys((current) =>
      current.includes(seatKey)
        ? current.filter((key) => key !== seatKey)
        : [...current, seatKey],
    );
  }

  async function cancelSelected() {
    const targets = cancelKeys
      .map((key) => reservationMap.get(key))
      .filter((item): item is LunchReservation => Boolean(item));
    if (!targets.length) return;

    const preview = targets
      .slice(0, 8)
      .map(
        (item) =>
          `${lunchSeatLabel(item.tableId, item.seatNumber)}（${item.name}）`,
      )
      .join("\n");
    const confirmed = window.confirm(
      `確定要取消以下 ${targets.length} 個位子嗎？\n\n${preview}${targets.length > 8 ? `\n…等共 ${targets.length} 個` : ""}`,
    );
    if (!confirmed) return;

    const password = askEditPassword("取消位子");
    if (!password) return;

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/lunch-reservations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seatKeys: targets.map((item) => item.seatKey),
          password,
        }),
      });
      if (handlePasswordRejection(response.status)) {
        throw new Error("確認密碼不正確，請再試一次。");
      }
      if (!response.ok) throw new Error("取消失敗");
      await loadAll(true);
      setMessage(`已取消 ${targets.length} 個位子。`);
      setCancelKeys([]);
    } catch {
      setMessage("取消失敗，請稍後再試。");
      await loadAll(true);
    } finally {
      setSaving(false);
    }
  }

  /** 換位模式：第一次點是拿起來，第二次點是換過去或互換。 */
  async function tapForSwap(seatKey: string) {
    setMessage("");
    if (!swapFrom) {
      if (reservationMap.has(seatKey)) setSwapFrom(seatKey);
      else setMessage("請先點一個已經有人的位子，再點要換到哪裡。");
      return;
    }
    if (swapFrom === seatKey) {
      setSwapFrom(null);
      return;
    }

    const source = reservationMap.get(swapFrom);
    if (!source) {
      setSwapFrom(null);
      setMessage("剛剛選的位子已經被取消了，請重新選一次。");
      return;
    }
    const target = reservationMap.get(seatKey);
    const fromLabel = lunchSeatLabel(source.tableId, source.seatNumber);
    const toLabel = lunchSeatLabel(
      seatKey.slice(0, seatKey.lastIndexOf("-")),
      Number(seatKey.slice(seatKey.lastIndexOf("-") + 1)),
    );
    const confirmed = window.confirm(
      target
        ? `要把 ${source.name}（${fromLabel}）和 ${target.name}（${toLabel}）互換嗎？`
        : `要把 ${source.name} 從 ${fromLabel} 換到 ${toLabel} 嗎？`,
    );
    if (!confirmed) return;

    const password = askEditPassword("換位");
    if (!password) return;

    setSaving(true);
    try {
      const response = await fetch("/api/lunch-reservations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: swapFrom, to: seatKey, password }),
      });
      handlePasswordRejection(response.status);
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "換位失敗");
      await loadAll(true);
      setMessage(
        target
          ? `已將 ${source.name} 與 ${target.name} 互換。`
          : `已把 ${source.name} 換到 ${toLabel}。`,
      );
      setSwapFrom(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "換位失敗，請再試一次。");
      await loadAll(true);
      setSwapFrom(null);
    } finally {
      setSaving(false);
    }
  }

  /** 兩張桌子的人整批對調。 */
  async function swapWholeTables() {
    const source = wholeTableSelected;
    const other = tableById.get(moveTarget.slice("swap:".length));
    if (!source || !other) return;
    const sourceCount = cancelKeys.length;
    const otherCount = reservations.filter(
      (item) => item.tableId === other.id,
    ).length;

    const confirmed = window.confirm(
      `要把 ${source} 桌的 ${sourceCount} 位與 ${other.id} 桌的 ${otherCount} 位整桌對調嗎？`,
    );
    if (!confirmed) return;

    const password = askEditPassword("整桌對調");
    if (!password) return;

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/lunch-reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          swapTables: { a: source, b: other.id },
          password,
        }),
      });
      handlePasswordRejection(response.status);
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "對調失敗");
      await loadAll(true);
      setMessage(`已把 ${source} 桌與 ${other.id} 桌整桌對調。`);
      setCancelKeys([]);
      setMoveTarget("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "對調失敗，請再試一次。");
      await loadAll(true);
    } finally {
      setSaving(false);
    }
  }

  async function moveSelected() {
    if (isSwapTarget) {
      await swapWholeTables();
      return;
    }
    const targets = cancelKeys
      .map((key) => reservationMap.get(key))
      .filter((item): item is LunchReservation => Boolean(item));
    const destination = tableById.get(moveTarget);
    if (!targets.length || !destination) return;

    const who = Array.from(new Set(targets.map((item) => item.name))).join("、");
    const from = Array.from(new Set(targets.map((item) => item.tableId))).join(
      "、",
    );
    const confirmed = window.confirm(
      `要把 ${from} 桌的 ${targets.length} 位（${who}）整批換到 ${destination.id} 桌嗎？`,
    );
    if (!confirmed) return;

    const password = askEditPassword("整批換桌");
    if (!password) return;

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/lunch-reservations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seatKeys: targets.map((item) => item.seatKey),
          targetTableId: destination.id,
          password,
        }),
      });
      handlePasswordRejection(response.status);
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "換桌失敗");
      await loadAll(true);
      setMessage(`已把 ${targets.length} 位換到 ${destination.id} 桌。`);
      setCancelKeys([]);
      setMoveTarget("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "換桌失敗，請再試一次。");
      await loadAll(true);
    } finally {
      setSaving(false);
    }
  }

  async function addPlate() {
    const cleanedPlate = normalizePlate(plateNumber);
    const cleanedName = plateName.trim() || name.trim();
    if (!cleanedName) {
      setPlateMessage("請先填寫車主姓名。");
      return;
    }
    if (!isValidPlate(cleanedPlate)) {
      setPlateMessage("車號格式看起來不太對，例如：ABC-1234 或 1234-AB。");
      return;
    }
    setPlateSaving(true);
    setPlateMessage("");
    try {
      const response = await fetch("/api/parking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plate: cleanedPlate,
          name: cleanedName,
          note: plateNote.trim(),
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "登記失敗");
      await loadAll(true);
      setPlateMessage(
        `已登記車號 ${formatPlate(cleanedPlate)}，用餐當天由餐廳折抵停車費。`,
      );
      setPlateNumber("");
      setPlateNote("");
    } catch (error) {
      setPlateMessage(
        error instanceof Error ? error.message : "登記失敗，請再試一次。",
      );
    } finally {
      setPlateSaving(false);
    }
  }

  async function removePlate(entry: PlateEntry) {
    if (
      !window.confirm(`確定刪除 ${entry.name} 的車號 ${formatPlate(entry.plate)} 嗎？`)
    )
      return;
    setPlateSaving(true);
    try {
      const response = await fetch("/api/parking", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plate: entry.plate }),
      });
      if (!response.ok) throw new Error("刪除失敗");
      await loadAll(true);
      setPlateMessage(`已刪除車號 ${formatPlate(entry.plate)}。`);
    } catch {
      setPlateMessage("刪除失敗，請稍後再試。");
    } finally {
      setPlateSaving(false);
    }
  }

  async function postMessage() {
    const who = boardName.trim() || name.trim();
    const text = boardBody.trim();
    if (!who) {
      setBoardMessage("請先填暱稱。");
      return;
    }
    if (!text) {
      setBoardMessage("請先寫點什麼再送出。");
      return;
    }
    setBoardSaving(true);
    setBoardMessage("");
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: who, body: text }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "留言失敗");
      setBoardBody("");
      setBoardName(who);
      await loadAll(true);
    } catch (error) {
      setBoardMessage(error instanceof Error ? error.message : "留言失敗，請再試一次。");
    } finally {
      setBoardSaving(false);
    }
  }

  async function removeMessage(item: BoardMessage) {
    if (!window.confirm(`確定刪除 ${item.name} 的留言嗎？`)) return;
    setBoardSaving(true);
    try {
      const response = await fetch("/api/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      if (!response.ok) throw new Error("刪除失敗");
      await loadAll(true);
    } catch {
      setBoardMessage("刪除失敗，請稍後再試。");
    } finally {
      setBoardSaving(false);
    }
  }

  function downloadSeatCsv() {
    downloadCsv(
      deptFilter
        ? `0807午餐座位名單_${deptFilter}.csv`
        : "0807午餐座位名單.csv",
      [
      ["區域", "桌號", "位子", "姓名", "部門／備註", "可放嬰兒座椅", "選位時間"],
      ...rosterRows
        .map((item) => {
          const table = tableById.get(item.tableId);
          return [
            zoneOfTable.get(item.tableId) ?? "",
            item.tableId,
            String(item.seatNumber),
            item.name,
            item.note,
            table && allowsBabySeat(table) ? "可" : "",
            new Date(item.createdAt).toLocaleString("zh-TW"),
          ];
        }),
      ],
    );
  }

  function downloadPlateCsv() {
    downloadCsv("0807午餐停車折抵車號.csv", [
      ["車號", "車主姓名", "備註", "登記時間"],
      ...plates.map((item) => [
        formatPlate(item.plate),
        item.name,
        item.note,
        new Date(item.createdAt).toLocaleString("zh-TW"),
      ]),
    ]);
  }

  const activeZoneData = lunchZones.find((zone) => zone.id === activeZone)!;
  const activeZoneTables = activeZoneData.groups.flatMap((group) => group.tables);
  const activeZoneColumns = Math.max(...activeZoneTables.map((item) => item.col));
  const openTable = openTableId ? tableById.get(openTableId) : undefined;

  function seatNumbersOf(item: LunchTable) {
    return Array.from({ length: item.capacity }, (_, index) => index + 1);
  }

  function takenCountOf(item: LunchTable) {
    return seatNumbersOf(item).filter((seatNumber) =>
      reservationMap.has(lunchSeatKey(item.id, seatNumber)),
    ).length;
  }

  /** 一次選起某桌所有已劃走的位子；已經全選時再按一次就取消選取。 */
  function markWholeTable(item: LunchTable) {
    const keys = seatNumbersOf(item)
      .map((seatNumber) => lunchSeatKey(item.id, seatNumber))
      .filter((seatKey) => reservationMap.has(seatKey));
    const allMarked = keys.every((seatKey) => cancelKeys.includes(seatKey));
    setCancelKeys((current) =>
      allMarked
        ? current.filter((seatKey) => !keys.includes(seatKey))
        : Array.from(new Set([...current, ...keys])),
    );
  }

  function renderTableCard(item: LunchTable) {
    const taken = takenCountOf(item);
    return (
      <div
        className={`table-card ${item.shape} ${taken === item.capacity ? "full" : ""}`}
        key={item.id}
      >
        <header>
          <b>
            {item.id}
            {allowsBabySeat(item) && (
              <i className="baby-badge" title="可放嬰兒座椅">
                🍼
              </i>
            )}
          </b>
          <span>
            {item.capacity - taken} / {item.capacity} 可選
          </span>
        </header>
        {item.hint && <p className="table-hint">{item.hint}</p>}
        {taken > 0 && !swapMode && (
          <button
            className="pick-table"
            onClick={() => markWholeTable(item)}
            disabled={saving}
            title={`把 ${item.id} 桌目前 ${taken} 位一起選起來，可整批換桌或取消`}
          >
            選整桌（{taken} 位）
          </button>
        )}
        <div className="table-seats">
          {seatNumbersOf(item).map((seatNumber) => {
            const seatKey = lunchSeatKey(item.id, seatNumber);
            const reservation = reservationMap.get(seatKey);
            const selected = selectedSeats.some(
              (seat) => seat.seatKey === seatKey,
            );
            const label = lunchSeatLabel(item.id, seatNumber);
            const marked = cancelKeys.includes(seatKey);
            const holding = swapFrom === seatKey;
            const droppable = swapMode && Boolean(swapFrom) && !holding;
            return (
              <button
                key={seatKey}
                className={`seat-button ${reservation ? "occupied" : ""} ${selected ? "selected" : ""} ${marked && !swapMode ? "to-cancel" : ""} ${holding ? "holding" : ""} ${droppable ? "droppable" : ""} ${matchedKeys.has(seatKey) ? "match" : ""} ${foundKey === seatKey ? "found" : ""}`}
                data-seat={seatKey}
                disabled={saving}
                onClick={() =>
                  swapMode
                    ? void tapForSwap(seatKey)
                    : reservation
                      ? toggleCancel(seatKey)
                      : toggleSeat({ seatKey, tableId: item.id, seatNumber })
                }
                aria-pressed={swapMode ? holding : reservation ? marked : selected}
                aria-label={`${label}${reservation ? `，${reservation.name}` : "，空位"}`}
                title={
                  swapMode
                    ? reservation
                      ? `${reservation.name}・${label}・點擊${swapFrom ? "與這位互換" : "拿起來"}`
                      : `${label}・${swapFrom ? "點擊換到這裡" : "空位"}`
                    : reservation
                      ? `${reservation.name}・${label}・點擊標記取消`
                      : label
                }
              >
                <span>{seatNumber}</span>
                {reservation && <small>{reservation.name}</small>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <main>
      <header className="hero">
        <div className="hero-inner">
          <div>
            <p className="eyebrow">0807 LUNCH · 饗 A JOY</p>
            <h1>
              午餐座位，<span>自己挑一桌</span>
            </h1>
            <p className="hero-copy">
              鄭婉芃（台積電）座位圖・桌號後方數字為每桌可安排人數
            </p>
          </div>
          <div className="event-card">
            <div>
              <b>8/7</b>
              <span>星期五</span>
            </div>
            <i />
            <div>
              <b>{LUNCH_TOTAL_SEATS}</b>
              <span>可選位子</span>
            </div>
          </div>
        </div>
      </header>

      <section className="content">
        <nav className="page-nav">
          <Link href="/">🏟️ 棒球賽劃位</Link>
          <span className="current">🍽️ 午餐座位</span>
          <Link href="/lunch/import">📋 批次匯入</Link>
        </nav>

        <div className="status-strip">
          <div>
            <span className="live-dot" />
            座位即時更新
          </div>
          <div className="seat-count">
            <strong>{availableCount}</strong> 個位子可選
            <span>/ 共 {LUNCH_TOTAL_SEATS} 位</span>
          </div>
        </div>

        <section className="identity-card">
          <div className="step-number">1</div>
          <div className="identity-copy">
            <h2>先留下你的名字</h2>
            <p>方便餐廳與主辦確認每桌人數</p>
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
            <span>參加人數 *</span>
            <select
              className="party-size"
              value={partySize}
              onChange={(event) => setPartySize(Number(event.target.value))}
            >
              {Array.from({ length: MAX_PARTY_SIZE }, (_, index) => index + 1).map(
                (size) => (
                  <option key={size} value={size}>
                    {size} 位{size > 1 ? `（含眷屬 ${size - 1} 位）` : "（僅本人）"}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            <span>部門／備註</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="選填，例如：ISDD-01、素食"
              maxLength={40}
            />
          </label>
        </section>

        <section className="picker-card">
          <div className="picker-heading">
            <div>
              <span className="step-number">2</span>
              <div>
                <h2>選擇你的桌次與位子</h2>
                <p>
                  可同時選擇多個空位；點已有人的位子可以把人選起來，一次整批換桌或取消
                </p>
              </div>
            </div>
            <div className="legend">
              <span>
                <i className="seat available" />
                可選
              </span>
              <span>
                <i className="seat selected" />
                已選
              </span>
              <span>
                <i className="seat occupied" />
                已有人
              </span>
              <span>
                <i className="seat to-cancel" />
                已選取
              </span>
            </div>
          </div>

          <button
            className="plan-toggle"
            onClick={() => setShowPlan((value) => !value)}
          >
            {showPlan ? "收起餐廳平面圖 ↑" : "查看餐廳平面圖 ↓"}
          </button>
          {showPlan && (
            <figure className="plan-figure">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/lunch-floorplan.jpg" alt="0807 午餐座位平面圖" />
              <figcaption>
                英文＋數字為桌號，米字號數字為每桌可安排人數。圖上標示 194 位，實際
                R05、R06、R07 改為 4 人桌，本次共 {LUNCH_TOTAL_SEATS} 位。
              </figcaption>
            </figure>
          )}

          {orphanReservations.length > 0 && (
            <p className="baby-note orphan-note">
              <span aria-hidden="true">⚠️</span>
              <span>
                有 <b>{orphanReservations.length}</b> 筆資料坐在已經被移除的位子上（
                {orphanReservations
                  .map(
                    (item) =>
                      `${item.name}：${lunchSeatLabel(item.tableId, item.seatNumber)}`,
                  )
                  .join("、")}
                ），座位圖上看不到他們。請幫這幾位重新安排位子。
                <button
                  onClick={() =>
                    setCancelKeys(orphanReservations.map((item) => item.seatKey))
                  }
                >
                  選起來準備處理
                </button>
              </span>
            </p>
          )}

          <div className="seat-search">
            <div className="seat-search-box">
              <span aria-hidden="true">🔍</span>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setFoundKey(null);
                }}
                placeholder="輸入姓名或課別，找出坐在哪裡"
                maxLength={30}
                aria-label="搜尋姓名或課別"
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery("");
                    setFoundKey(null);
                  }}
                >
                  清除
                </button>
              )}
            </div>
            {query.trim() &&
              (searchResults.length ? (
                <div className="seat-search-results">
                  <b>找到 {searchResults.length} 位</b>
                  <div>
                    {searchResults.slice(0, 30).map((item) => (
                      <button
                        key={item.seatKey}
                        className={foundKey === item.seatKey ? "active" : ""}
                        onClick={() => goToSeat(item)}
                      >
                        <span>{item.name}</span>
                        <small>
                          {lunchSeatLabel(item.tableId, item.seatNumber)}
                          {item.note ? `・${item.note}` : ""}
                        </small>
                      </button>
                    ))}
                  </div>
                  {searchResults.length > 30 && (
                    <small className="more">
                      還有 {searchResults.length - 30} 位，請再輸入更完整的關鍵字
                    </small>
                  )}
                </div>
              ) : (
                <p className="seat-search-empty">
                  找不到「{query.trim()}」，可能還沒有選位。
                </p>
              ))}
          </div>

          <div className="mode-row">
            <div className="view-tabs">
              <button
                className={viewMode === "list" ? "active" : ""}
                onClick={() => setViewMode("list")}
              >
                座位卡片
              </button>
              <button
                className={viewMode === "map" ? "active" : ""}
                onClick={() => setViewMode("map")}
              >
                平面圖總覽
              </button>
            </div>
            <button
              className={`swap-toggle ${swapMode ? "active" : ""}`}
              onClick={() => {
                setSwapMode((value) => !value);
                setSwapFrom(null);
                setCancelKeys([]);
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
                  已拿起{" "}
                  <b>{reservationMap.get(swapFrom)?.name ?? "—"}</b>
                  ，請點要換到的位子：點空位是搬過去，點別人是兩人互換。
                  <button onClick={() => setSwapFrom(null)}>取消</button>
                </>
              ) : (
                <>點一個已經有人的位子把他拿起來，再點另一個位子即可換位。</>
              )}
            </p>
          )}

          {viewMode === "list" && (
            <>
              <div className="section-tabs">
                {lunchZones.map((zone) => (
                  <button
                    key={zone.id}
                    className={activeZone === zone.id ? "active" : ""}
                    onClick={() => setActiveZone(zone.id)}
                  >
                    <b>{zone.label}</b>
                    <span>
                      {zoneCapacity[zone.id] - zoneTakenCount[zone.id]} 位可選
                    </span>
                  </button>
                ))}
              </div>
              <p className="zone-hint">{activeZoneData.hint}</p>
            </>
          )}

          <p className="baby-note">
            <span aria-hidden="true">🍼</span>
            <span>
              <b>需要嬰兒座椅的請看這裡：</b>
              所有<b>圓桌</b>都可以放嬰兒座椅，另外 R 區中間的{" "}
              <b>R17、R27、R13、R23</b> 這四張方桌也放得下。桌號旁有 🍼
              標記的即可安排，共 {babySeatTableIds.length} 桌。
            </span>
          </p>

          {viewMode === "map" ? (
            <>
              <p className="map-hint">
                桌子的位置與座位圖一致。點一張桌子就會展開該桌位子，選好之後可以再點別桌繼續選。
                <span className="scroll-hint">手機請左右滑動查看完整平面圖。</span>
              </p>

              <div className="floor-map-wrap">
                <div
                  className="floor-map"
                  style={{ aspectRatio: FLOOR_ASPECT_RATIO }}
                  aria-busy={loading}
                >
                  <div className="floor-map-inner">
                    {floorLandmarks.map((landmark) => (
                      <span
                        className="floor-landmark"
                        key={landmark.label}
                        style={{ left: `${landmark.x}%`, top: `${landmark.y}%` }}
                      >
                        {landmark.label}
                      </span>
                    ))}
                    {lunchTables.map((item) => {
                      const taken = takenCountOf(item);
                      const full = taken === item.capacity;
                      const size = floorTableSize(item);
                      const selectedHere = selectedSeats.filter(
                        (seat) => seat.tableId === item.id,
                      ).length;
                      return (
                        <button
                          key={item.id}
                          className={`floor-table ${item.shape} ${full ? "full" : ""} ${openTableId === item.id ? "open" : ""} ${selectedHere ? "has-selected" : ""}`}
                          style={{
                            left: `${item.x}%`,
                            top: `${item.y}%`,
                            width: size.width,
                            height: size.height,
                          }}
                          onClick={() =>
                            setOpenTableId((current) =>
                              current === item.id ? null : item.id,
                            )
                          }
                          aria-expanded={openTableId === item.id}
                          title={`${item.id} 桌・${item.capacity} 人・剩 ${item.capacity - taken} 位${allowsBabySeat(item) ? "・可放嬰兒座椅" : ""}`}
                        >
                          {allowsBabySeat(item) && (
                            <i className="floor-baby" aria-hidden="true">
                              🍼
                            </i>
                          )}
                          <b>{item.id}</b>
                          <span className="floor-dots">
                            {seatNumbersOf(item).map((seatNumber) => {
                              const seatKey = lunchSeatKey(item.id, seatNumber);
                              const state = matchedKeys.has(seatKey)
                                ? "matched"
                                : cancelKeys.includes(seatKey)
                                ? "cancelling"
                                : reservationMap.has(seatKey)
                                  ? "taken"
                                  : selectedSeats.some(
                                        (seat) => seat.seatKey === seatKey,
                                      )
                                    ? "picked"
                                    : "free";
                              return <i className={state} key={seatKey} />;
                            })}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {openTable ? (
                <div className="table-detail">
                  <div className="table-detail-head">
                    <span>
                      <b>
                        {openTable.id} 桌・{openTable.capacity} 人
                        {allowsBabySeat(openTable) && "・🍼 可放嬰兒座椅"}
                      </b>
                      <small>
                        還有 {openTable.capacity - takenCountOf(openTable)} 個空位
                      </small>
                    </span>
                    <button onClick={() => setOpenTableId(null)}>收起</button>
                  </div>
                  {renderTableCard(openTable)}
                </div>
              ) : (
                <p className="table-detail-empty">
                  ↑ 點平面圖上的任一張桌子，這裡就會顯示該桌的位子
                </p>
              )}
            </>
          ) : (
            <>
              <p className="map-hint">
                卡片的前後左右順序與座位圖一致，位子直接顯示在卡片上。
                <span className="scroll-hint">手機請左右滑動查看完整排列。</span>
              </p>
              <div className="table-grid-wrap">
                <div
                  className="table-grid-map"
                  aria-busy={loading}
                  style={{
                    gridTemplateColumns: `repeat(${activeZoneColumns}, minmax(146px, 1fr))`,
                    minWidth: activeZoneColumns * 146 + (activeZoneColumns - 1) * 12,
                  }}
                >
                  {activeZoneTables.map((item) => (
                    <div
                      key={item.id}
                      className="table-cell"
                      style={{ gridColumn: item.col, gridRow: item.row }}
                    >
                      {renderTableCard(item)}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="confirm-bar">
            <div>
              <span>
                參加人數 {partySize} 位・已選 {selectedSeats.length} 個位子
                {selectedSeats.length !== partySize &&
                  (selectedSeats.length < partySize
                    ? `（還要選 ${partySize - selectedSeats.length} 個）`
                    : `（多選了 ${selectedSeats.length - partySize} 個）`)}
              </span>
              <strong>
                {selectedSeats.length
                  ? selectedSeats
                      .map((seat) => lunchSeatLabel(seat.tableId, seat.seatNumber))
                      .join("、")
                  : "—"}
              </strong>
            </div>
            <button
              onClick={reserveSeats}
              disabled={
                selectedSeats.length !== partySize || !name.trim() || saving
              }
            >
              {saving ? "處理中…" : `確認選擇 ${partySize} 位`}
            </button>
          </div>

          {cancelKeys.length > 0 && !swapMode && (
            <div className="confirm-bar cancel-bar">
              <div>
                <span>已選取 {cancelKeys.length} 個已劃位子</span>
                <strong>
                  {cancelKeys
                    .map((key) => reservationMap.get(key))
                    .filter(Boolean)
                    .map(
                      (item) =>
                        `${lunchSeatLabel(item!.tableId, item!.seatNumber)}（${item!.name}）`,
                    )
                    .join("、")}
                </strong>
              </div>
              <div className="cancel-bar-actions">
                <button
                  className="ghost"
                  onClick={() => setCancelKeys([])}
                  disabled={saving}
                >
                  清除選取
                </button>
                <div className="move-control">
                  <select
                    className={
                      !moveTargetValid && (moveOptions.length || swapOptions.length)
                        ? "needs-choice"
                        : ""
                    }
                    value={moveTargetValid ? moveTarget : ""}
                    onChange={(event) => setMoveTarget(event.target.value)}
                    disabled={saving || !(moveOptions.length || swapOptions.length)}
                    aria-label="換到哪一桌"
                  >
                    <option value="">
                      {moveOptions.length || swapOptions.length
                        ? "換到哪一桌…"
                        : `沒有桌子能一次容納 ${cancelKeys.length} 位`}
                    </option>
                    {moveOptions.length > 0 && (
                      <optgroup label="搬到空位">
                        {moveOptions.map(({ item, freeAfter }) => (
                          <option key={item.id} value={item.id}>
                            {item.id}（空 {freeAfter} / {item.capacity} 位）
                            {allowsBabySeat(item) ? " 🍼" : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {swapOptions.length > 0 && (
                      <optgroup label="與整桌對調">
                        {swapOptions.map(({ item, people }) => (
                          <option key={item.id} value={`swap:${item.id}`}>
                            {item.id}（目前 {people} 位）
                            {allowsBabySeat(item) ? " 🍼" : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <button
                    className="move"
                    onClick={moveSelected}
                    disabled={saving || !moveTargetValid}
                  >
                    {saving
                      ? "處理中…"
                      : !moveTargetValid
                        ? "先選目標桌"
                        : isSwapTarget
                          ? "整桌對調"
                          : "整批換桌"}
                  </button>
                </div>
                <button onClick={cancelSelected} disabled={saving}>
                  {saving ? "處理中…" : `取消這 ${cancelKeys.length} 個位子`}
                </button>
              </div>
            </div>
          )}
          {message && (
            <p className="message" role="status">
              {message}
            </p>
          )}
        </section>

        <section className="picker-card parking-card">
          <div className="picker-heading">
            <div>
              <span className="step-number">3</span>
              <div>
                <h2>登記車號折抵停車費</h2>
                <p>開車來的人請填車號，會統一提供給餐廳折抵停車費</p>
              </div>
            </div>
          </div>

          <div className="parking-form">
            <label>
              <span>車主姓名 *</span>
              <input
                value={plateName}
                onChange={(event) => setPlateName(event.target.value)}
                placeholder={name.trim() ? `留空則用「${name.trim()}」` : "請輸入姓名"}
                maxLength={30}
              />
            </label>
            <label>
              <span>車號 *</span>
              <input
                value={plateNumber}
                onChange={(event) => setPlateNumber(event.target.value)}
                placeholder="例如：ABC-1234"
                maxLength={12}
                autoCapitalize="characters"
              />
            </label>
            <label>
              <span>備註</span>
              <input
                value={plateNote}
                onChange={(event) => setPlateNote(event.target.value)}
                placeholder="選填，例如：白色轎車"
                maxLength={40}
              />
            </label>
            <button onClick={addPlate} disabled={plateSaving}>
              {plateSaving ? "處理中…" : "登記車號"}
            </button>
          </div>
          {plateMessage && (
            <p className="message" role="status">
              {plateMessage}
            </p>
          )}

          <div className="roster-actions">
            <p>目前已登記 {plates.length} 台車，名單每 5 秒自動更新。</p>
            <button onClick={downloadPlateCsv} disabled={!plates.length}>
              下載車號 CSV
            </button>
          </div>
          {plates.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>車號</th>
                    <th>車主</th>
                    <th>備註</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {plates.map((item) => (
                    <tr key={item.plate}>
                      <td>
                        <b>{formatPlate(item.plate)}</b>
                      </td>
                      <td>{item.name}</td>
                      <td>{item.note || "—"}</td>
                      <td>
                        <button
                          className="table-action"
                          onClick={() => removePlate(item)}
                          disabled={plateSaving}
                        >
                          刪除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">還沒有人登記車號。</p>
          )}
        </section>

        <section className="roster">
          <button
            className="roster-toggle"
            onClick={() => setShowList((value) => !value)}
          >
            <span>
              <b>目前午餐座位名單</b>
              <small>已完成 {reservations.length} 個位子</small>
            </span>
            <span>
              {showList ? "收起" : "查看"}　{showList ? "↑" : "↓"}
            </span>
          </button>
          {showList && (
            <div className="roster-content">
              {deptOptions.length > 1 && (
                <div className="dept-filter">
                  <b>只看</b>
                  <div>
                    <button
                      className={deptFilter === "" ? "active" : ""}
                      onClick={() => setDeptFilter("")}
                    >
                      全部 <i>{reservations.length}</i>
                    </button>
                    {deptOptions.map(([dept, count]) => (
                      <button
                        key={dept}
                        className={deptFilter === dept ? "active" : ""}
                        onClick={() =>
                          setDeptFilter((current) =>
                            current === dept ? "" : dept,
                          )
                        }
                      >
                        {dept} <i>{count}</i>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="roster-actions">
                <p>
                  名單每 5 秒自動更新。勾選左邊的方框可以一次換桌或取消多個位子，
                  {deptFilter && (
                    <b>目前只顯示「{deptFilter}」{rosterRows.length} 位。</b>
                  )}
                  {cancelKeys.length > 0 && (
                    <b>已勾選 {cancelKeys.length} 個。</b>
                  )}
                </p>
                <div className="roster-buttons">
                  {cancelKeys.length > 0 && (
                    <div className="move-control">
                      <select
                        className={
                          !moveTargetValid &&
                          (moveOptions.length || swapOptions.length)
                            ? "needs-choice"
                            : ""
                        }
                        value={moveTargetValid ? moveTarget : ""}
                        onChange={(event) => setMoveTarget(event.target.value)}
                        disabled={
                          saving || !(moveOptions.length || swapOptions.length)
                        }
                        aria-label="換到哪一桌"
                      >
                        <option value="">
                          {moveOptions.length || swapOptions.length
                            ? "換到哪一桌…"
                            : `沒有桌子能一次容納 ${cancelKeys.length} 位`}
                        </option>
                        {moveOptions.length > 0 && (
                          <optgroup label="搬到空位">
                            {moveOptions.map(({ item, freeAfter }) => (
                              <option key={item.id} value={item.id}>
                                {item.id}（空 {freeAfter} / {item.capacity} 位）
                                {allowsBabySeat(item) ? " 🍼" : ""}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {swapOptions.length > 0 && (
                          <optgroup label="與整桌對調">
                            {swapOptions.map(({ item, people }) => (
                              <option key={item.id} value={`swap:${item.id}`}>
                                {item.id}（目前 {people} 位）
                                {allowsBabySeat(item) ? " 🍼" : ""}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      <button
                        className="move"
                        onClick={moveSelected}
                        disabled={saving || !moveTargetValid}
                      >
                        {!moveTargetValid
                          ? "先選目標桌"
                          : isSwapTarget
                            ? "整桌對調"
                            : "整批換桌"}
                      </button>
                    </div>
                  )}
                  <button
                    className="danger"
                    onClick={cancelSelected}
                    disabled={!cancelKeys.length || saving}
                  >
                    {saving
                      ? "處理中…"
                      : `取消所選${cancelKeys.length ? ` ${cancelKeys.length} 個` : ""}`}
                  </button>
                  <button onClick={downloadSeatCsv} disabled={!rosterRows.length}>
                    下載座位 CSV{deptFilter ? `（${rosterRows.length} 位）` : ""}
                  </button>
                </div>
              </div>
              {rosterRows.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th className="check-cell">
                          <input
                            type="checkbox"
                            aria-label="全選"
                            checked={allRosterChecked}
                            onChange={(event) =>
                              setCancelKeys((current) =>
                                event.target.checked
                                  ? Array.from(
                                      new Set([...current, ...rosterKeys]),
                                    )
                                  : current.filter(
                                      (key) => !rosterKeys.includes(key),
                                    ),
                              )
                            }
                          />
                        </th>
                        <th>桌號</th>
                        <th>位子</th>
                        <th>姓名</th>
                        <th>部門／備註</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rosterRows.map((item) => {
                          const table = tableById.get(item.tableId);
                          return (
                          <tr
                            key={item.seatKey}
                            className={
                              cancelKeys.includes(item.seatKey) ? "marked" : ""
                            }
                          >
                            <td className="check-cell">
                              <input
                                type="checkbox"
                                aria-label={`選取 ${lunchSeatLabel(item.tableId, item.seatNumber)}`}
                                checked={cancelKeys.includes(item.seatKey)}
                                onChange={() => toggleCancel(item.seatKey)}
                                disabled={saving}
                              />
                            </td>
                            <td>
                              {item.tableId}
                              {table && allowsBabySeat(table) && (
                                <i className="baby-badge" title="可放嬰兒座椅">
                                  🍼
                                </i>
                              )}
                            </td>
                            <td>{item.seatNumber} 號位</td>
                            <td>{item.name}</td>
                            <td>{item.note || "—"}</td>
                          </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty">
                  {deptFilter
                    ? `「${deptFilter}」目前沒有人選位。`
                    : "目前還沒有人選位，成為第一位吧！"}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="picker-card board-card">
          <div className="picker-heading">
            <div>
              <span className="step-number">💬</span>
              <div>
                <h2>留言板</h2>
                <p>找人併桌、揪團、問問題都可以，大家都看得到</p>
              </div>
            </div>
            <span className="board-count">{messages.length} 則留言</span>
          </div>

          <div className="board-list">
            {messages.length ? (
              messages.map((item) => (
                <div className="board-item" key={item.id}>
                  <div className="board-item-head">
                    <b>{item.name}</b>
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString("zh-TW", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <button
                      onClick={() => removeMessage(item)}
                      disabled={boardSaving}
                      title="刪除這則留言"
                    >
                      ✕
                    </button>
                  </div>
                  <p>{item.body}</p>
                </div>
              ))
            ) : (
              <p className="empty">還沒有人留言，來說第一句吧！</p>
            )}
          </div>

          <div className="board-form">
            <input
              value={boardName}
              onChange={(event) => setBoardName(event.target.value)}
              placeholder={name.trim() ? `留空則用「${name.trim()}」` : "你的暱稱"}
              maxLength={30}
              aria-label="暱稱"
            />
            <textarea
              value={boardBody}
              onChange={(event) => setBoardBody(event.target.value)}
              onKeyDown={(event) => {
                // Ctrl/⌘ + Enter 直接送出，跟一般聊天室一樣。
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void postMessage();
                }
              }}
              placeholder="想說什麼？（Ctrl / ⌘ + Enter 送出）"
              maxLength={300}
              rows={2}
              aria-label="留言內容"
            />
            <button onClick={postMessage} disabled={boardSaving}>
              {boardSaving ? "送出中…" : "送出"}
            </button>
          </div>
          <div className="board-foot">
            <small>{boardBody.length} / 300</small>
            {boardMessage && <small className="warn">{boardMessage}</small>}
          </div>
        </section>

        <footer>
          <p>座位、車號與留言皆為公開資訊，請只把連結提供給預期的使用者。</p>
        </footer>
      </section>
    </main>
  );
}
