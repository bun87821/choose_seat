import {
  lunchTables,
  tableById,
  zoneOfTable,
  type LunchTable,
} from "./lunch-tables";

/** 一位同仁與他的眷屬算一組，排位時盡量不拆開。 */
export type Party = {
  name: string;
  dept: string;
  /** 參加人數，含本人。 */
  size: number;
};

export type Assignment = {
  tableId: string;
  seatNumber: number;
  /** 顯示在座位上的名字，眷屬會標成「王小明 眷1」。 */
  name: string;
  dept: string;
  partyName: string;
  isGuest: boolean;
};

export type AssignResult = {
  assignments: Assignment[];
  unplaced: Party[];
  /** 因為沒有夠大的桌子而被拆開的組別。 */
  splitParties: string[];
};

export type AssignOptions = {
  /** 同課別的人盡量安排在同一桌，坐不下才往鄰近的桌子擠。 */
  keepDeptTogether: boolean;
  /** 人數多的課別先挑桌，通常會拿到大桌。 */
  bigDeptsFirst: boolean;
};

/** 顯示用：維持座位圖上「一排一排由左往右」的閱讀順序。 */
const tableOrder = new Map(lunchTables.map((item, index) => [item.id, index]));

/**
 * 把座位圖上 x 座標相近的桌子歸成同一直行。
 * 相差 3%（約一張桌子的寬度）以內視為同一行。
 */
const columnStarts = (() => {
  const xs = [...new Set(lunchTables.map((item) => item.x))].sort(
    (a, b) => a - b,
  );
  const starts: number[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const x of xs) {
    if (x - previous > 3) starts.push(x);
    previous = x;
  }
  return starts;
})();

function columnOf(item: LunchTable) {
  let index = 0;
  for (let i = 0; i < columnStarts.length; i += 1) {
    if (item.x >= columnStarts[i] - 0.001) index = i;
  }
  return index;
}

/**
 * 排位順序：從餐廳最右邊的直行往左推進，同一行由上往下。
 *
 * 如果照桌號由左往右排，第一個（也是人最多的）課別會把整排靠窗的
 * 桌子一次吃光。改成一行一行往左走，每個課別拿到的是縱向的一小塊，
 * 靠窗的位子就會分散給不同課別。
 */
const fillOrder = new Map(
  [...lunchTables]
    .sort((a, b) => columnOf(b) - columnOf(a) || a.y - b.y)
    .map((item, index) => [item.id, index] as const),
);

/** 匯出給介面說明用：實際的排位推進順序。 */
export const fillOrderedTableIds = [...fillOrder.entries()]
  .sort((a, b) => a[1] - b[1])
  .map(([id]) => id);

/**
 * 一個課別的座位只會落在同一個區塊裡。R 區與 B 區在餐廳的兩側，
 * R10 又離其他 R 桌很遠，所以各自獨立，避免「連續」跨到場地另一邊。
 */
function clusterOf(tableId: string) {
  return tableId === "R10" ? "R10" : (zoneOfTable.get(tableId) ?? "?");
}

type OpenTable = {
  table: LunchTable;
  seats: number[];
};

export const MAX_PARTY_SIZE = 10;

/**
 * 把名單解析成組別。每行「姓名<Tab 或逗號>課別<Tab 或逗號>參加人數」，
 * 人數省略或不是數字時當作 1 人。
 */
export function parseRoster(input: string): {
  parties: Party[];
  headcount: number;
  skipped: number;
} {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parties: Party[] = [];
  let skipped = 0;

  for (const [index, line] of lines.entries()) {
    const cells = line
      .split(/\t|,|、|｜|\||;/)
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (!cells.length) {
      skipped += 1;
      continue;
    }
    // 第一行如果是標題就跳過。
    if (index === 0 && /姓名|名字|name/i.test(cells[0]) && cells.length > 1) {
      continue;
    }
    const [name, dept = "", rawSize = ""] = cells;
    const parsedSize = Number.parseInt(rawSize.replace(/[^\d]/g, ""), 10);
    const size =
      Number.isFinite(parsedSize) && parsedSize >= 1
        ? Math.min(parsedSize, MAX_PARTY_SIZE)
        : 1;
    if (name.length > 30 || dept.length > 40) {
      skipped += 1;
      continue;
    }
    parties.push({ name, dept, size });
  }

  return {
    parties,
    headcount: parties.reduce((total, party) => total + party.size, 0),
    skipped,
  };
}

/** 眷屬的顯示名稱。 */
export function guestName(name: string, index: number) {
  return index === 0 ? name : `${name} 眷${index}`;
}

/** 目前還沒被劃走的位子，依桌號整理成「桌 → 空位號碼」。 */
export function openSeatsByTable(takenSeatKeys: Iterable<string>) {
  const taken = new Set(takenSeatKeys);
  const open = new Map<string, number[]>();
  for (const item of lunchTables) {
    const seats = Array.from(
      { length: item.capacity },
      (_, index) => index + 1,
    ).filter((seatNumber) => !taken.has(`${item.id}-${seatNumber}`));
    if (seats.length) open.set(item.id, seats);
  }
  return open;
}

/** 依座位圖順序排好，合併兩批排位結果時用。 */
export function sortAssignments(assignments: Assignment[]) {
  return [...assignments].sort(
    (a, b) =>
      (tableOrder.get(a.tableId) ?? 0) - (tableOrder.get(b.tableId) ?? 0) ||
      a.seatNumber - b.seatNumber,
  );
}

/**
 * 幫一個課別找一段「座位圖上連續」的桌子，總空位剛好裝得下 need 個人。
 * 先求用到的桌子數最少（同課別越集中越好），再求浪費的空位最少。
 */
function findBlock(open: OpenTable[], need: number) {
  let best: { start: number; end: number; span: number; waste: number } | null =
    null;

  for (let start = 0; start < open.length; start += 1) {
    if (!open[start].seats.length) continue;
    const cluster = clusterOf(open[start].table.id);
    let total = 0;
    let span = 0;
    for (let end = start; end < open.length; end += 1) {
      if (!open[end].seats.length) continue;
      if (clusterOf(open[end].table.id) !== cluster) break;
      total += open[end].seats.length;
      span += 1;
      if (total < need) continue;
      const waste = total - need;
      const better =
        !best || span < best.span || (span === best.span && waste < best.waste);
      if (better) best = { start, end, span, waste };
      break;
    }
  }

  return best;
}

export function assignSeats(
  parties: Party[],
  openSeats: Map<string, number[]>,
  options: AssignOptions,
): AssignResult {
  const open: OpenTable[] = [...openSeats.entries()]
    .map(([tableId, seats]) => ({
      table: tableById.get(tableId)!,
      seats: [...seats].sort((a, b) => a - b),
    }))
    .filter((entry) => entry.table && entry.seats.length)
    // 由右往左推進，避免同一個課別橫掃整排靠窗的桌子。
    .sort(
      (a, b) =>
        (fillOrder.get(a.table.id) ?? 0) - (fillOrder.get(b.table.id) ?? 0),
    );

  const assignments: Assignment[] = [];
  const unplaced: Party[] = [];
  const splitParties: string[] = [];

  /** 把一整組安排到同一桌的連續空位上。 */
  function seatParty(entry: OpenTable, party: Party, offset = 0) {
    for (let index = 0; index < party.size; index += 1) {
      const seatNumber = entry.seats.shift()!;
      assignments.push({
        tableId: entry.table.id,
        seatNumber,
        name: guestName(party.name, offset + index),
        dept: party.dept,
        partyName: party.name,
        isGuest: offset + index > 0,
      });
    }
  }

  /** 在指定範圍的桌子裡，優先塞得下的整組先坐，不拆散任何一組。 */
  function fillWholeParties(
    entries: OpenTable[],
    remaining: Party[],
  ): Party[] {
    for (const entry of entries) {
      let placed = true;
      while (placed && entry.seats.length && remaining.length) {
        placed = false;
        const index = remaining.findIndex(
          (party) => party.size <= entry.seats.length,
        );
        if (index >= 0) {
          seatParty(entry, remaining[index]);
          remaining.splice(index, 1);
          placed = true;
        }
      }
      if (!remaining.length) break;
    }
    return remaining;
  }

  /** 最後手段：真的沒有桌子容得下整組時才拆開。 */
  function forceSeat(remaining: Party[]) {
    for (const party of remaining) {
      let seated = 0;
      let split = false;
      while (seated < party.size) {
        const entry = open.find((item) => item.seats.length);
        if (!entry) break;
        const count = Math.min(entry.seats.length, party.size - seated);
        seatParty(entry, { ...party, size: count }, seated);
        if (seated > 0 || count < party.size) split = true;
        seated += count;
      }
      if (split && party.size > 1) splitParties.push(party.name);
      if (seated < party.size) {
        unplaced.push({ ...party, size: party.size - seated });
      }
    }
  }

  if (!options.keepDeptTogether) {
    const leftover = fillWholeParties(open, [...parties]);
    forceSeat(leftover);
    return { assignments: sortAssignments(assignments), unplaced, splitParties };
  }

  // 依課別分組，保留名單中第一次出現的順序當作預設排序。
  const groups = new Map<string, Party[]>();
  for (const party of parties) {
    const key = party.dept || "（未填課別）";
    const list = groups.get(key);
    if (list) list.push(party);
    else groups.set(key, [party]);
  }

  const ordered = [...groups.entries()];
  const headcountOf = (list: Party[]) =>
    list.reduce((total, party) => total + party.size, 0);
  if (options.bigDeptsFirst) {
    ordered.sort((a, b) => headcountOf(b[1]) - headcountOf(a[1]));
  }

  const leftovers: Party[] = [];
  for (const [, members] of ordered) {
    // 大組先挑桌，比較不會卡在剩下的零星空位。
    const remaining = [...members].sort((a, b) => b.size - a.size);
    const block = findBlock(open, headcountOf(remaining));
    const entries = block
      ? open.slice(block.start, block.end + 1)
      : [...open];
    leftovers.push(...fillWholeParties(entries, remaining));
  }

  // 課別區塊填不下的，再看全場還有沒有整組坐得下的地方。
  const stillLeft = fillWholeParties(open, leftovers);
  forceSeat(stillLeft);

  return { assignments: sortAssignments(assignments), unplaced, splitParties };
}
