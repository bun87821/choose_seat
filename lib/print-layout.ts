import {
  baseballSectionSeats,
  type BaseballSection,
} from "./baseball-seats.ts";
import {
  lunchSeatKey,
  lunchZones,
  validLunchSeatKeys,
} from "./lunch-tables.ts";

export type BaseballPrintReservation = {
  seatKey: string;
  section: BaseballSection;
  row: number;
  number: number;
  name: string;
  note: string;
  createdAt: string;
};

export type LunchPrintReservation = {
  seatKey: string;
  tableId: string;
  seatNumber: number;
  name: string;
  note: string;
  createdAt: string;
};

export type PrintSeat = {
  key: string;
  number: number;
  name: string;
  note: string;
};

export type BaseballPrintSection = {
  id: BaseballSection;
  rows: Array<{ number: number; seats: PrintSeat[] }>;
};

export type LunchPrintZone = {
  id: "R" | "B";
  label: string;
  tables: Array<{ id: string; capacity: number; seats: PrintSeat[] }>;
};

function printSeat(
  key: string,
  number: number,
  reservation?: { name: string; note: string },
): PrintSeat {
  return {
    key,
    number,
    name: reservation?.name ?? "",
    note: reservation?.note ?? "",
  };
}

export function buildBaseballPrintSections(
  reservations: BaseballPrintReservation[],
): BaseballPrintSection[] {
  const reservationMap = new Map(
    reservations.map((reservation) => [reservation.seatKey, reservation]),
  );

  return (Object.keys(baseballSectionSeats) as BaseballSection[]).map((id) => {
    const seats = baseballSectionSeats[id];
    const rowNumbers = [...new Set(seats.map((seat) => seat.row))];
    return {
      id,
      rows: rowNumbers.map((number) => ({
        number,
        seats: seats
          .filter((seat) => seat.row === number)
          .map((seat) =>
            printSeat(seat.key, seat.number, reservationMap.get(seat.key)),
          ),
      })),
    };
  });
}

export function buildLunchPrintZones(
  reservations: LunchPrintReservation[],
): LunchPrintZone[] {
  const reservationMap = new Map(
    reservations.map((reservation) => [reservation.seatKey, reservation]),
  );

  return lunchZones.map((zone) => ({
    id: zone.id,
    label: zone.label,
    tables: zone.groups.flatMap((group) =>
      group.tables.map((table) => ({
        id: table.id,
        capacity: table.capacity,
        seats: Array.from({ length: table.capacity }, (_, index) => {
          const number = index + 1;
          const key = lunchSeatKey(table.id, number);
          return printSeat(key, number, reservationMap.get(key));
        }),
      })),
    ),
  }));
}

export function findOrphanLunchReservations(
  reservations: LunchPrintReservation[],
) {
  return reservations.filter(
    (reservation) => !validLunchSeatKeys.has(reservation.seatKey),
  );
}
