export type TableShape = "round" | "rect";

export type LunchTable = {
  id: string;
  capacity: number;
  shape: TableShape;
};

export type LunchGroup = {
  id: string;
  label: string;
  tables: LunchTable[];
};

export type LunchZone = {
  id: "R" | "B";
  label: string;
  hint: string;
  groups: LunchGroup[];
};

function table(id: string, capacity: number, shape: TableShape): LunchTable {
  return { id, capacity, shape };
}

/**
 * 依 0807 午餐 194 位座位圖建立。英文＋數字為桌號，米字號數字為每桌可安排人數。
 */
export const lunchZones: LunchZone[] = [
  {
    id: "R",
    label: "R 區",
    hint: "靠酒吧、甜點與茶飲區",
    groups: [
      {
        id: "R-1",
        label: "第一排・最靠酒吧",
        tables: [
          table("R09", 4, "rect"),
          table("R08", 4, "rect"),
          table("R07", 5, "rect"),
          table("R06", 5, "rect"),
          table("R05", 5, "rect"),
          table("R03", 5, "rect"),
          table("R02", 4, "rect"),
          table("R01", 4, "rect"),
        ],
      },
      {
        id: "R-2",
        label: "第二排",
        tables: [
          table("R19", 5, "round"),
          table("R18", 2, "rect"),
          table("R17", 4, "rect"),
          table("R16", 5, "round"),
          table("R15", 5, "round"),
          table("R13", 4, "rect"),
          table("R12", 2, "rect"),
          table("R11", 5, "round"),
        ],
      },
      {
        id: "R-3",
        label: "第三排",
        tables: [
          table("R29", 5, "round"),
          table("R28", 2, "rect"),
          table("R27", 4, "rect"),
          table("R26", 5, "round"),
          table("R25", 5, "round"),
          table("R23", 4, "rect"),
          table("R22", 2, "rect"),
          table("R21", 5, "round"),
        ],
      },
      {
        id: "R-4",
        label: "茶飲區旁・靠電梯廳入口",
        tables: [table("R10", 8, "round")],
      },
    ],
  },
  {
    id: "B",
    label: "B 區",
    hint: "靠市府路側",
    groups: [
      {
        id: "B-1",
        label: "大圓桌區",
        tables: [
          table("B37", 7, "round"),
          table("B36", 7, "round"),
          table("B25", 7, "round"),
          table("B23", 7, "round"),
        ],
      },
      {
        id: "B-2",
        label: "靠市府路・上段",
        tables: [
          table("B35", 6, "round"),
          table("B33", 4, "rect"),
          table("B32", 4, "rect"),
          table("B31", 4, "rect"),
        ],
      },
      {
        id: "B-3",
        label: "中段圓桌",
        tables: [
          table("B22", 4, "round"),
          table("B21", 4, "round"),
          table("B20", 4, "round"),
          table("B18", 4, "round"),
        ],
      },
      {
        id: "B-4",
        label: "靠市府路・下段",
        tables: [
          table("B09", 4, "rect"),
          table("B08", 4, "rect"),
          table("B07", 4, "rect"),
          table("B06", 4, "rect"),
        ],
      },
      {
        id: "B-5",
        label: "雙人桌區",
        tables: [
          table("B17", 2, "rect"),
          table("B16", 2, "rect"),
          table("B15", 2, "rect"),
          table("B13", 2, "rect"),
        ],
      },
    ],
  },
];

export const lunchTables: LunchTable[] = lunchZones.flatMap((zone) =>
  zone.groups.flatMap((group) => group.tables),
);

export const zoneOfTable = new Map<string, "R" | "B">(
  lunchZones.flatMap((zone) =>
    zone.groups.flatMap((group) => group.tables.map((item) => [item.id, zone.id] as const)),
  ),
);

export const tableById = new Map(lunchTables.map((item) => [item.id, item]));

export const LUNCH_TOTAL_SEATS = lunchTables.reduce(
  (total, item) => total + item.capacity,
  0,
);

export function lunchSeatKey(tableId: string, seatNumber: number) {
  return `${tableId}-${seatNumber}`;
}

export const validLunchSeatKeys = new Set(
  lunchTables.flatMap((item) =>
    Array.from({ length: item.capacity }, (_, index) => lunchSeatKey(item.id, index + 1)),
  ),
);

export function lunchSeatLabel(tableId: string, seatNumber: number) {
  return `${tableId} 桌｜${seatNumber} 號位`;
}

/** R 區中間幾張方桌雖然不是圓桌，一樣放得下嬰兒座椅。 */
const BABY_SEAT_RECT_TABLES = new Set(["R17", "R27", "R13", "R23"]);

/** 圓桌都可以放嬰兒座椅，另外加上 R 區中間的 R17、R27、R13、R23。 */
export function allowsBabySeat(item: LunchTable) {
  return item.shape === "round" || BABY_SEAT_RECT_TABLES.has(item.id);
}

export const babySeatTableIds = lunchTables
  .filter((item) => allowsBabySeat(item))
  .map((item) => item.id);
