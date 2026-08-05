export type TableShape = "round" | "rect";

export type LunchTable = {
  id: string;
  capacity: number;
  shape: TableShape;
  /** 桌子中心在平面圖上的相對位置（百分比），用來畫成一比一的座位圖。 */
  x: number;
  y: number;
  /** 同一份相對位置換算成的格線欄／列，用來把卡片排成座位圖的樣子。 */
  col: number;
  row: number;
  /** 位置比較特別的桌子補一句說明。 */
  hint?: string;
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

function table(
  id: string,
  capacity: number,
  shape: TableShape,
  x: number,
  y: number,
  col: number,
  row: number,
  hint?: string,
): LunchTable {
  return { id, capacity, shape, x, y, col, row, hint };
}

/**
 * 依 0807 午餐 194 位座位圖建立。英文＋數字為桌號，米字號數字為每桌可安排人數。
 */
const rZone: LunchZone = {
  id: "R",
  label: "R 區",
  hint: "靠酒吧、甜點與茶飲區",
  groups: [
    {
      id: "R-1",
      label: "第一排・最靠酒吧",
      tables: [
        table("R09", 4, "rect", 31.4, 3.4, 1, 1),
        table("R08", 4, "rect", 35.5, 3.4, 2, 1),
        table("R07", 5, "rect", 42.3, 3.4, 3, 1),
        table("R06", 5, "rect", 47.3, 3.4, 4, 1),
        table("R05", 5, "rect", 52.1, 3.4, 5, 1),
        table("R03", 5, "rect", 57.1, 3.4, 6, 1),
        table("R02", 4, "rect", 63.9, 3.4, 7, 1),
        table("R01", 4, "rect", 68.5, 3.4, 8, 1),
      ],
    },
    {
      id: "R-2",
      label: "第二排",
      tables: [
        table("R19", 5, "round", 31.6, 14.6, 1, 2),
        table("R18", 2, "rect", 36.2, 14.6, 2, 2),
        table("R17", 4, "rect", 41.0, 14.6, 3, 2),
        table("R16", 5, "round", 46.5, 14.6, 4, 2),
        table("R15", 5, "round", 53.0, 14.6, 5, 2),
        table("R13", 4, "rect", 58.8, 14.6, 6, 2),
        table("R12", 2, "rect", 63.2, 14.6, 7, 2),
        table("R11", 5, "round", 67.8, 14.6, 8, 2),
      ],
    },
    {
      id: "R-3",
      label: "第三排",
      tables: [
        table("R29", 5, "round", 31.6, 24.4, 1, 3),
        table("R28", 2, "rect", 36.2, 24.4, 2, 3),
        table("R27", 4, "rect", 41.0, 24.4, 3, 3),
        table("R26", 5, "round", 46.5, 24.4, 4, 3),
        table("R25", 5, "round", 53.0, 24.4, 5, 3),
        table("R23", 4, "rect", 58.8, 24.4, 6, 3),
        table("R22", 2, "rect", 63.2, 24.4, 7, 3),
        table("R21", 5, "round", 67.8, 24.4, 8, 3),
      ],
    },
    {
      id: "R-4",
      label: "茶飲區旁・靠電梯廳入口",
      tables: [table("R10", 8, "round", 94.8, 35.6, 8, 4, "更右側・茶飲區旁")],
    },
  ],
};

const bZone: LunchZone = {
  id: "B",
  label: "B 區",
  hint: "靠市府路側",
  groups: [
    {
      id: "B-1",
      label: "大圓桌區",
      tables: [
        table("B37", 7, "round", 21.3, 6.3, 5, 1),
        table("B36", 7, "round", 16.0, 10.6, 4, 2),
        table("B25", 7, "round", 21.5, 15.6, 5, 3),
        table("B23", 7, "round", 16.2, 20.1, 4, 4),
      ],
    },
    {
      id: "B-2",
      label: "靠市府路・上段",
      tables: [
        table("B35", 6, "round", 7.9, 12.3, 2, 2),
        table("B33", 4, "rect", 4.8, 20.9, 2, 4),
        table("B32", 4, "rect", 2.7, 29.1, 1, 5),
        table("B31", 4, "rect", 2.7, 36.5, 1, 6),
      ],
    },
    {
      id: "B-3",
      label: "中段圓桌",
      tables: [
        table("B22", 4, "round", 9.9, 27.9, 3, 5),
        table("B21", 4, "round", 9.9, 37.5, 3, 6),
        table("B20", 4, "round", 9.9, 51.0, 3, 7),
        table("B18", 4, "round", 9.9, 61.9, 3, 8),
      ],
    },
    {
      id: "B-4",
      label: "靠市府路・下段",
      tables: [
        table("B09", 4, "rect", 2.7, 51.0, 1, 7),
        table("B08", 4, "rect", 2.7, 59.4, 1, 8),
        table("B07", 4, "rect", 2.7, 70.6, 1, 9),
        table("B06", 4, "rect", 2.7, 78.8, 1, 10),
      ],
    },
    {
      id: "B-5",
      label: "雙人桌區",
      tables: [
        table("B17", 2, "rect", 8.2, 70.8, 2, 9),
        table("B16", 2, "rect", 8.2, 78.8, 2, 10),
        table("B15", 2, "rect", 8.2, 87.9, 2, 11),
        table("B13", 2, "rect", 8.2, 95.6, 2, 12),
      ],
    },
  ],
};

/** B 區在餐廳左側、R 區在右側，順序與座位圖上的左右關係一致。 */
export const lunchZones: LunchZone[] = [bZone, rZone];

export const lunchTables: LunchTable[] = lunchZones.flatMap((zone) =>
  zone.groups.flatMap((group) => group.tables),
);

export const zoneOfTable = new Map<string, "R" | "B">(
  lunchZones.flatMap((zone) =>
    zone.groups.flatMap((group) =>
      group.tables.map((item) => [item.id, zone.id] as const),
    ),
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
    Array.from({ length: item.capacity }, (_, index) =>
      lunchSeatKey(item.id, index + 1),
    ),
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

/** 平面圖上的固定設施，讓大家在座位圖裡認得方向。 */
export const floorLandmarks: Array<{ label: string; x: number; y: number }> = [
  { label: "酒吧", x: 83.1, y: 8.1 },
  { label: "咖啡吧", x: 93.4, y: 20.1 },
  { label: "甜點", x: 64.0, y: 37.5 },
  { label: "茶飲", x: 77.2, y: 37.5 },
  { label: "自助餐檯區", x: 48.5, y: 56.9 },
  { label: "電梯廳入口", x: 67.5, y: 83.8 },
];

/** 平面圖畫布的長寬比，與原始座位圖上桌子分布的範圍一致。 */
export const FLOOR_ASPECT_RATIO = "1360 / 800";

/** 桌子在平面圖上的顯示尺寸，大桌畫大一點，維持與座位圖相近的比例。 */
export function floorTableSize(item: LunchTable) {
  return item.shape === "round"
    ? { width: 40 + item.capacity * 3.5, height: 40 + item.capacity * 3.5 }
    : { width: 40 + item.capacity * 3, height: 34 + item.capacity * 2 };
}

export const babySeatTableIds = lunchTables
  .filter((item) => allowsBabySeat(item))
  .map((item) => item.id);
