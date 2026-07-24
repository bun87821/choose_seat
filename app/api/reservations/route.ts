import { ensureSchema, pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReservationRow = {
  seat_key: string;
  section: "B1" | "B2";
  row_number: number;
  seat_number: number;
  name: string;
  note: string;
  created_at: Date | string;
};

const TOTAL_SEATS = 70;

const validSeats = new Set([
  ...[12, 13, 14].flatMap((row) =>
    Array.from({ length: 9 }, (_, index) => `B1-${row}-${index + 4}`),
  ),
  ...Array.from({ length: 8 }, (_, index) => `B1-15-${index + 5}`),
  ...Array.from({ length: 9 }, (_, index) => `B1-16-${index + 6}`),
  ...Array.from({ length: 6 }, (_, index) => `B2-14-${index + 7}`),
  ...[15, 16].flatMap((row) =>
    Array.from({ length: 10 }, (_, index) => `B2-${row}-${index + 5}`),
  ),
]);

function serialize(row: ReservationRow) {
  return {
    seatKey: row.seat_key,
    section: row.section,
    row: row.row_number,
    number: row.seat_number,
    name: row.name,
    note: row.note,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  };
}

export async function GET() {
  try {
    await ensureSchema();
    const result = await pool.query<ReservationRow>(
      `SELECT seat_key, section, row_number, seat_number, name, note, created_at
       FROM reservations
       ORDER BY section, row_number, seat_number`,
    );
    return Response.json({
      reservations: result.rows.map((row) => serialize(row)),
    });
  } catch (error) {
    console.error("GET /api/reservations failed", error);
    return Response.json(
      { error: "無法讀取座位，請稍後再試。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const client = await pool.connect();
  try {
    await ensureSchema();
    const payload = (await request.json()) as {
      seats?: Array<{
        key?: string;
        section?: string;
        row?: number;
        number?: number;
      }>;
      name?: string;
      note?: string;
      reservationKey?: string;
    };
    const seats = payload.seats ?? [];
    const name = payload.name?.trim() ?? "";
    const note = payload.note?.trim() ?? "";
    const reservationKey =
      payload.reservationKey?.trim() ||
      (typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);

    if (
      !seats.length ||
      seats.length > TOTAL_SEATS ||
      new Set(seats.map((seat) => seat.key)).size !== seats.length ||
      seats.some((seat) => {
        const seatKey = `${seat.section}-${Number(seat.row)}-${Number(seat.number)}`;
        return seat.key !== seatKey || !validSeats.has(seatKey);
      })
    ) {
      return Response.json(
        { error: "請確認所選座位是否正確。" },
        { status: 400 },
      );
    }

    if (
      !name ||
      name.length > 30 ||
      note.length > 40
    ) {
      return Response.json(
        { error: "請確認姓名與備註內容。" },
        { status: 400 },
      );
    }

    await client.query("BEGIN");
    for (const seat of seats) {
      await client.query(
        `INSERT INTO reservations
          (seat_key, section, row_number, seat_number, name, note, reservation_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          seat.key,
          seat.section,
          Number(seat.row),
          Number(seat.number),
          name,
          note,
          reservationKey,
        ],
      );
    }
    await client.query("COMMIT");
    return Response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (code === "23505") {
      return Response.json(
        { error: "其中一個座位剛被別人選走了，請重新選擇。" },
        { status: 409 },
      );
    }
    console.error("POST /api/reservations failed", error);
    return Response.json(
      { error: "劃位失敗，請稍後再試。" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureSchema();
    const payload = (await request.json()) as {
      seatKey?: string;
    };
    const seatKey = payload.seatKey?.trim() ?? "";

    if (!seatKey || !validSeats.has(seatKey)) {
      return Response.json({ error: "無效的劃位資料" }, { status: 400 });
    }

    await pool.query("DELETE FROM reservations WHERE seat_key = $1", [seatKey]);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/reservations failed", error);
    return Response.json({ error: "取消失敗" }, { status: 500 });
  }
}
