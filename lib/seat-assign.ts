import {
  lunchTables,
  tableById,
  zoneOfTable,
  type LunchTable,
} from "./lunch-tables";

export type Person = {
  name: string;
  dept: string;
};

export type Assignment = {
  tableId: string;
  seatNumber: number;
  name: string;
  dept: string;
};

export type AssignResult = {
  assignments: Assignment[];
  unplaced: Person[];
};

export type AssignOptions = {
  /** 同課別的人盡量安排在同一桌，坐不下才往鄰近的桌子擠。 */
  keepDeptTogether: boolean;
  /** 人數多的課別先挑桌，通常會拿到大桌。 */
  bigDeptsFirst: boolean;
};

const tableOrder = new Map(lunchTables.map((item, index) => [item.id, index]));

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

/** 把名單解析成人員清單。每行「姓名<Tab 或逗號>課別」，多餘的欄位會被忽略。 */
export function parseRoster(input: string): {
  people: Person[];
  skipped: number;
} {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const people: Person[] = [];
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
    const [name, dept = ""] = cells;
    if (name.length > 30 || dept.length > 40) {
      skipped += 1;
      continue;
    }
    people.push({ name, dept });
  }

  return { people, skipped };
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
        !best ||
        span < best.span ||
        (span === best.span && waste < best.waste);
      if (better) best = { start, end, span, waste };
      break;
    }
  }

  return best;
}

export function assignSeats(
  people: Person[],
  openSeats: Map<string, number[]>,
  options: AssignOptions,
): AssignResult {
  const open: OpenTable[] = [...openSeats.entries()]
    .map(([tableId, seats]) => ({
      table: tableById.get(tableId)!,
      seats: [...seats].sort((a, b) => a - b),
    }))
    .filter((entry) => entry.table && entry.seats.length)
    .sort(
      (a, b) =>
        (tableOrder.get(a.table.id) ?? 0) - (tableOrder.get(b.table.id) ?? 0),
    );

  const assignments: Assignment[] = [];
  const unplaced: Person[] = [];

  const take = (entry: OpenTable, person: Person) => {
    const seatNumber = entry.seats.shift()!;
    assignments.push({
      tableId: entry.table.id,
      seatNumber,
      name: person.name,
      dept: person.dept,
    });
  };

  if (!options.keepDeptTogether) {
    let cursor = 0;
    for (const person of people) {
      while (cursor < open.length && !open[cursor].seats.length) cursor += 1;
      if (cursor >= open.length) {
        unplaced.push(person);
        continue;
      }
      take(open[cursor], person);
    }
    return { assignments, unplaced };
  }

  // 依課別分組，保留名單中第一次出現的順序當作預設排序。
  const groups = new Map<string, Person[]>();
  for (const person of people) {
    const key = person.dept || "（未填課別）";
    const list = groups.get(key);
    if (list) list.push(person);
    else groups.set(key, [person]);
  }

  const ordered = [...groups.entries()];
  if (options.bigDeptsFirst) {
    ordered.sort((a, b) => b[1].length - a[1].length);
  }

  for (const [, members] of ordered) {
    const remaining = [...members];
    const block = findBlock(open, remaining.length);

    if (block) {
      for (let index = block.start; index <= block.end && remaining.length; index += 1) {
        const entry = open[index];
        const count = Math.min(entry.seats.length, remaining.length);
        for (let seat = 0; seat < count; seat += 1) take(entry, remaining.shift()!);
      }
      continue;
    }

    // 剩下的空位已經湊不出一整段，能塞多少算多少。
    for (const entry of open) {
      while (entry.seats.length && remaining.length) take(entry, remaining.shift()!);
      if (!remaining.length) break;
    }
    unplaced.push(...remaining);
  }

  assignments.sort(
    (a, b) =>
      (tableOrder.get(a.tableId) ?? 0) - (tableOrder.get(b.tableId) ?? 0) ||
      a.seatNumber - b.seatNumber,
  );

  return { assignments, unplaced };
}
