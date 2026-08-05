import { ensureLunchSchema, pool } from "@/lib/db";
import {
  LUNCH_TOTAL_SEATS,
  lunchSeatKey,
  tableById,
  validLunchSeatKeys,
} from "@/lib/lunch-tables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LunchReservationRow = {
  seat_key: string;
  table_id: string;
  seat_number: number;
  name: string;
  note: string;
  created_at: Date | string;
};

function serialize(row: LunchReservationRow) {
  return {
    seatKey: row.seat_key,
    tableId: row.table_id,
    seatNumber: row.seat_number,
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
    await ensureLunchSchema();
    const result = await pool.query<LunchReservationRow>(
      `SELECT seat_key, table_id, seat_number, name, note, created_at
       FROM lunch_reservations
       ORDER BY table_id, seat_number`,
    );
    return Response.json({
      reservations: result.rows.map((row) => serialize(row)),
    });
  } catch (error) {
    console.error("GET /api/lunch-reservations failed", error);
    return Response.json(
      { error: "無法讀取座位，請稍後再試。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const client = await pool.connect();
  try {
    await ensureLunchSchema();
    const payload = (await request.json()) as {
      seats?: Array<{ tableId?: string; seatNumber?: number }>;
      name?: string;
      note?: string;
    };
    const seats = payload.seats ?? [];
    const name = payload.name?.trim() ?? "";
    const note = payload.note?.trim() ?? "";

    const seatKeys = seats.map((seat) =>
      lunchSeatKey(String(seat.tableId), Number(seat.seatNumber)),
    );

    if (
      !seats.length ||
      seats.length > LUNCH_TOTAL_SEATS ||
      new Set(seatKeys).size !== seatKeys.length ||
      seatKeys.some((seatKey) => !validLunchSeatKeys.has(seatKey))
    ) {
      return Response.json(
        { error: "請確認所選座位是否正確。" },
        { status: 400 },
      );
    }

    if (!name || name.length > 30 || note.length > 40) {
      return Response.json(
        { error: "請確認姓名與備註內容。" },
        { status: 400 },
      );
    }

    await client.query("BEGIN");
    for (const [index, seat] of seats.entries()) {
      await client.query(
        `INSERT INTO lunch_reservations
          (seat_key, table_id, seat_number, name, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          seatKeys[index],
          String(seat.tableId),
          Number(seat.seatNumber),
          name,
          note,
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
        { error: "其中一個位子剛被別人選走了，請重新選擇。" },
        { status: 409 },
      );
    }
    console.error("POST /api/lunch-reservations failed", error);
    return Response.json({ error: "選位失敗，請稍後再試。" }, { status: 500 });
  } finally {
    client.release();
  }
}

/** 把一批已經劃走的位子整批搬到另一張桌子，姓名與備註跟著走。 */
export async function PATCH(request: Request) {
  const client = await pool.connect();
  try {
    await ensureLunchSchema();
    const payload = (await request.json()) as {
      seatKeys?: string[];
      targetTableId?: string;
    };
    const seatKeys = Array.from(
      new Set((payload.seatKeys ?? []).map((item) => String(item).trim())),
    ).filter(Boolean);
    const targetTableId = String(payload.targetTableId ?? "").trim();
    const target = tableById.get(targetTableId);

    if (
      !seatKeys.length ||
      seatKeys.length > LUNCH_TOTAL_SEATS ||
      seatKeys.some((seatKey) => !validLunchSeatKeys.has(seatKey)) ||
      !target
    ) {
      return Response.json({ error: "請確認要換的位子與目標桌號。" }, { status: 400 });
    }
    if (seatKeys.length > target.capacity) {
      return Response.json(
        { error: `${target.id} 桌只能坐 ${target.capacity} 位，放不下這 ${seatKeys.length} 位。` },
        { status: 409 },
      );
    }

    await client.query("BEGIN");

    const source = await client.query<{
      seat_key: string;
      name: string;
      note: string;
      created_at: Date;
    }>(
      `SELECT seat_key, name, note, created_at
       FROM lunch_reservations
       WHERE seat_key = ANY($1::text[])
       ORDER BY table_id, seat_number
       FOR UPDATE`,
      [seatKeys],
    );
    if (source.rows.length !== seatKeys.length) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "其中一個位子剛被別人取消了，請重新整理後再試。" },
        { status: 409 },
      );
    }

    await client.query(
      "DELETE FROM lunch_reservations WHERE seat_key = ANY($1::text[])",
      [seatKeys],
    );

    const occupied = await client.query<{ seat_number: number }>(
      "SELECT seat_number FROM lunch_reservations WHERE table_id = $1 FOR UPDATE",
      [target.id],
    );
    const takenSeats = new Set(occupied.rows.map((row) => row.seat_number));
    const freeSeats = Array.from(
      { length: target.capacity },
      (_, index) => index + 1,
    ).filter((seatNumber) => !takenSeats.has(seatNumber));

    if (freeSeats.length < source.rows.length) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: `${target.id} 桌只剩 ${freeSeats.length} 個空位，放不下這 ${source.rows.length} 位。` },
        { status: 409 },
      );
    }

    for (const [index, row] of source.rows.entries()) {
      const seatNumber = freeSeats[index];
      await client.query(
        `INSERT INTO lunch_reservations
          (seat_key, table_id, seat_number, name, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          lunchSeatKey(target.id, seatNumber),
          target.id,
          seatNumber,
          row.name,
          row.note,
          row.created_at,
        ],
      );
    }

    await client.query("COMMIT");
    return Response.json({ ok: true, moved: source.rows.length });
  } catch (error) {
    await client.query("ROLLBACK");
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (code === "23505") {
      return Response.json(
        { error: "目標桌的位子剛被別人選走了，請重新整理後再試。" },
        { status: 409 },
      );
    }
    console.error("PATCH /api/lunch-reservations failed", error);
    return Response.json({ error: "換桌失敗，請稍後再試。" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureLunchSchema();
    const payload = (await request.json()) as {
      seatKey?: string;
      seatKeys?: string[];
    };
    // 舊的單筆格式仍然可用，新的批次取消則帶 seatKeys。
    const seatKeys = Array.from(
      new Set(
        (payload.seatKeys ?? (payload.seatKey ? [payload.seatKey] : []))
          .map((item) => String(item).trim())
          .filter(Boolean),
      ),
    );

    if (
      !seatKeys.length ||
      seatKeys.length > LUNCH_TOTAL_SEATS ||
      seatKeys.some((seatKey) => !validLunchSeatKeys.has(seatKey))
    ) {
      return Response.json({ error: "無效的座位資料" }, { status: 400 });
    }

    const result = await pool.query(
      "DELETE FROM lunch_reservations WHERE seat_key = ANY($1::text[])",
      [seatKeys],
    );
    return Response.json({ ok: true, removed: result.rowCount ?? 0 });
  } catch (error) {
    console.error("DELETE /api/lunch-reservations failed", error);
    return Response.json({ error: "取消失敗" }, { status: 500 });
  }
}
