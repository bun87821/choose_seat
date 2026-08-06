import {
  BASEBALL_TOTAL_SEATS,
  validBaseballSeatKeys,
} from "@/lib/baseball-seats";
import { ensureSchema, pool } from "@/lib/db";
import { isCorrectPassword, passwordRejected } from "@/lib/seat-password";

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
      seats.length > BASEBALL_TOTAL_SEATS ||
      new Set(seats.map((seat) => seat.key)).size !== seats.length ||
      seats.some((seat) => {
        const seatKey = `${seat.section}-${Number(seat.row)}-${Number(seat.number)}`;
        return seat.key !== seatKey || !validBaseballSeatKeys.has(seatKey);
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

/** 座位鍵是「區-排-號」。 */
function splitSeatKey(seatKey: string) {
  const [section, row, number] = seatKey.split("-");
  return { section, row: Number(row), number: Number(number) };
}

/**
 * 兩個位子對調：目標有人就互換，沒人就直接搬過去。
 * 給座位圖上「點一個人再點另一個位子」用。
 */
export async function PUT(request: Request) {
  const client = await pool.connect();
  try {
    await ensureSchema();
    const payload = (await request.json()) as {
      from?: string;
      to?: string;
      password?: string;
    };
    if (!isCorrectPassword(payload.password)) return passwordRejected();
    const from = payload.from?.trim() ?? "";
    const to = payload.to?.trim() ?? "";

    if (
      !validBaseballSeatKeys.has(from) ||
      !validBaseballSeatKeys.has(to) ||
      from === to
    ) {
      return Response.json({ error: "請確認要交換的兩個位子。" }, { status: 400 });
    }

    await client.query("BEGIN");
    const rows = await client.query<{
      seat_key: string;
      name: string;
      note: string;
      reservation_key: string;
      created_at: Date;
    }>(
      `SELECT seat_key, name, note, reservation_key, created_at
       FROM reservations
       WHERE seat_key = ANY($1::text[])
       FOR UPDATE`,
      [[from, to]],
    );
    const fromRow = rows.rows.find((row) => row.seat_key === from);
    if (!fromRow) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "這個座位剛剛被取消了，請重新整理後再試。" },
        { status: 409 },
      );
    }
    const toRow = rows.rows.find((row) => row.seat_key === to);

    await client.query(
      "DELETE FROM reservations WHERE seat_key = ANY($1::text[])",
      [[from, to]],
    );

    const place = async (
      seatKey: string,
      row: {
        name: string;
        note: string;
        reservation_key: string;
        created_at: Date;
      },
    ) => {
      const { section, row: rowNumber, number } = splitSeatKey(seatKey);
      await client.query(
        `INSERT INTO reservations
          (seat_key, section, row_number, seat_number, name, note, reservation_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          seatKey,
          section,
          rowNumber,
          number,
          row.name,
          row.note,
          row.reservation_key,
          row.created_at,
        ],
      );
    };

    await place(to, fromRow);
    if (toRow) await place(from, toRow);

    await client.query("COMMIT");
    return Response.json({ ok: true, swapped: Boolean(toRow) });
  } catch (error) {
    await client.query("ROLLBACK");
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (code === "23505") {
      return Response.json(
        { error: "座位剛被別人選走了，請重新整理後再試。" },
        { status: 409 },
      );
    }
    console.error("PUT /api/reservations failed", error);
    return Response.json({ error: "換位失敗，請稍後再試。" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureSchema();
    const payload = (await request.json()) as {
      seatKey?: string;
      password?: string;
    };
    if (!isCorrectPassword(payload.password)) return passwordRejected();
    const seatKey = payload.seatKey?.trim() ?? "";

    if (!seatKey || !validBaseballSeatKeys.has(seatKey)) {
      return Response.json({ error: "無效的劃位資料" }, { status: 400 });
    }

    await pool.query("DELETE FROM reservations WHERE seat_key = $1", [seatKey]);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/reservations failed", error);
    return Response.json({ error: "取消失敗" }, { status: 500 });
  }
}
