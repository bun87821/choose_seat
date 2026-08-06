export type BaseballSection = "B1" | "B2";

export type BaseballSeat = {
  key: string;
  section: BaseballSection;
  row: number;
  number: number;
};

function seats(
  section: BaseballSection,
  rows: Array<[number, number, number]>,
): BaseballSeat[] {
  return rows.flatMap(([row, first, last]) =>
    Array.from({ length: last - first + 1 }, (_, index) => ({
      key: `${section}-${row}-${first + index}`,
      section,
      row,
      number: first + index,
    })),
  );
}

export const baseballSectionSeats = {
  B1: seats("B1", [
    [12, 4, 12],
    [13, 4, 12],
    [14, 4, 12],
    [15, 5, 12],
    [16, 5, 14],
  ]),
  B2: seats("B2", [
    [14, 7, 12],
    [15, 5, 14],
    [16, 5, 14],
  ]),
} satisfies Record<BaseballSection, BaseballSeat[]>;

export const BASEBALL_TOTAL_SEATS =
  baseballSectionSeats.B1.length + baseballSectionSeats.B2.length;

export const validBaseballSeatKeys = new Set(
  Object.values(baseballSectionSeats)
    .flat()
    .map((seat) => seat.key),
);

export function baseballSeatLabel(
  seat: Pick<BaseballSeat, "section" | "row" | "number">,
) {
  return `${seat.section}｜${seat.row} 排 ${seat.number} 號`;
}
