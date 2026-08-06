import { ensureLunchSchema, pool } from "@/lib/db";
import { isCorrectPassword, passwordRejected } from "@/lib/seat-password";
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
      /** 批次匯入時每個位子各自帶姓名與課別。 */
      entries?: Array<{
        tableId?: string;
        seatNumber?: number;
        name?: string;
        note?: string;
      }>;
      name?: string;
      note?: string;
    };
    const sharedName = payload.name?.trim() ?? "";
    const sharedNote = payload.note?.trim() ?? "";
    const entries = payload.entries?.length
      ? payload.entries.map((entry) => ({
          tableId: String(entry.tableId),
          seatNumber: Number(entry.seatNumber),
          name: entry.name?.trim() ?? "",
          note: entry.note?.trim() ?? "",
        }))
      : (payload.seats ?? []).map((seat) => ({
          tableId: String(seat.tableId),
          seatNumber: Number(seat.seatNumber),
          name: sharedName,
          note: sharedNote,
        }));

    const seatKeys = entries.map((entry) =>
      lunchSeatKey(entry.tableId, entry.seatNumber),
    );

    if (
      !entries.length ||
      entries.length > LUNCH_TOTAL_SEATS ||
      new Set(seatKeys).size !== seatKeys.length ||
      seatKeys.some((seatKey) => !validLunchSeatKeys.has(seatKey))
    ) {
      return Response.json(
        { error: "請確認所選座位是否正確。" },
        { status: 400 },
      );
    }

    if (
      entries.some(
        (entry) =>
          !entry.name || entry.name.length > 30 || entry.note.length > 40,
      )
    ) {
      return Response.json(
        { error: "請確認姓名與備註內容。" },
        { status: 400 },
      );
    }

    await client.query("BEGIN");

    // 已經有人的位子絕對不動：先擋下來並回報是哪幾個，
    // 真的剛好同時寫入時還有主鍵當最後一道防線。
    const clash = await client.query<{ seat_key: string; name: string }>(
      `SELECT seat_key, name FROM lunch_reservations
       WHERE seat_key = ANY($1::text[])
       FOR UPDATE`,
      [seatKeys],
    );
    if (clash.rows.length) {
      await client.query("ROLLBACK");
      return Response.json(
        {
          error: `有 ${clash.rows.length} 個位子已經有人了，沒有寫入任何資料。`,
          conflicts: clash.rows.map((row) => row.seat_key),
        },
        { status: 409 },
      );
    }

    for (const [index, entry] of entries.entries()) {
      await client.query(
        `INSERT INTO lunch_reservations
          (seat_key, table_id, seat_number, name, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          seatKeys[index],
          entry.tableId,
          entry.seatNumber,
          entry.name,
          entry.note,
        ],
      );
    }
    await client.query("COMMIT");
    return Response.json({ ok: true, added: entries.length });
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

/** 座位鍵是「桌號-座號」，桌號本身不含連字號。 */
function splitSeatKey(seatKey: string) {
  const index = seatKey.lastIndexOf("-");
  return {
    tableId: seatKey.slice(0, index),
    seatNumber: Number(seatKey.slice(index + 1)),
  };
}

/**
 * 兩個位子對調：目標有人就互換，沒人就直接搬過去。
 * 給座位圖上「點一個人再點另一個位子」用。
 */
export async function PUT(request: Request) {
  const client = await pool.connect();
  try {
    await ensureLunchSchema();
    const payload = (await request.json()) as {
      from?: string;
      to?: string;
      password?: string;
    };
    if (!isCorrectPassword(payload.password)) return passwordRejected();
    const from = payload.from?.trim() ?? "";
    const to = payload.to?.trim() ?? "";

    if (
      !validLunchSeatKeys.has(from) ||
      !validLunchSeatKeys.has(to) ||
      from === to
    ) {
      return Response.json({ error: "請確認要交換的兩個位子。" }, { status: 400 });
    }

    await client.query("BEGIN");
    const rows = await client.query<{
      seat_key: string;
      name: string;
      note: string;
      created_at: Date;
    }>(
      `SELECT seat_key, name, note, created_at
       FROM lunch_reservations
       WHERE seat_key = ANY($1::text[])
       FOR UPDATE`,
      [[from, to]],
    );
    const fromRow = rows.rows.find((row) => row.seat_key === from);
    if (!fromRow) {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "這個位子剛剛被取消了，請重新整理後再試。" },
        { status: 409 },
      );
    }
    const toRow = rows.rows.find((row) => row.seat_key === to);

    await client.query(
      "DELETE FROM lunch_reservations WHERE seat_key = ANY($1::text[])",
      [[from, to]],
    );

    const place = async (
      seatKey: string,
      row: { name: string; note: string; created_at: Date },
    ) => {
      const { tableId, seatNumber } = splitSeatKey(seatKey);
      await client.query(
        `INSERT INTO lunch_reservations
          (seat_key, table_id, seat_number, name, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [seatKey, tableId, seatNumber, row.name, row.note, row.created_at],
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
        { error: "位子剛被別人選走了，請重新整理後再試。" },
        { status: 409 },
      );
    }
    console.error("PUT /api/lunch-reservations failed", error);
    return Response.json({ error: "換位失敗，請稍後再試。" }, { status: 500 });
  } finally {
    client.release();
  }
}

type SeatOccupant = {
  name: string;
  note: string;
  created_at: Date;
};

/** 兩張桌子的人整批對調：A 桌的人全部坐到 B 桌，B 桌的人全部坐到 A 桌。 */
async function swapWholeTables(
  client: import("pg").PoolClient,
  aId: string,
  bId: string,
) {
  const a = tableById.get(aId);
  const b = tableById.get(bId);
  if (!a || !b || a.id === b.id) {
    return Response.json({ error: "請確認要對調的兩張桌子。" }, { status: 400 });
  }

  await client.query("BEGIN");
  const rows = await client.query<SeatOccupant & { table_id: string; seat_number: number }>(
    `SELECT table_id, seat_number, name, note, created_at
     FROM lunch_reservations
     WHERE table_id = ANY($1::text[])
     ORDER BY table_id, seat_number
     FOR UPDATE`,
    [[a.id, b.id]],
  );
  const aPeople = rows.rows.filter((row) => row.table_id === a.id);
  const bPeople = rows.rows.filter((row) => row.table_id === b.id);

  if (!aPeople.length && !bPeople.length) {
    await client.query("ROLLBACK");
    return Response.json({ error: "這兩張桌子目前都沒有人。" }, { status: 400 });
  }
  if (aPeople.length > b.capacity) {
    await client.query("ROLLBACK");
    return Response.json(
      { error: `${a.id} 桌有 ${aPeople.length} 位，${b.id} 桌只能坐 ${b.capacity} 位。` },
      { status: 409 },
    );
  }
  if (bPeople.length > a.capacity) {
    await client.query("ROLLBACK");
    return Response.json(
      { error: `${b.id} 桌有 ${bPeople.length} 位，${a.id} 桌只能坐 ${a.capacity} 位。` },
      { status: 409 },
    );
  }

  await client.query(
    "DELETE FROM lunch_reservations WHERE table_id = ANY($1::text[])",
    [[a.id, b.id]],
  );

  const seat = async (tableId: string, people: SeatOccupant[]) => {
    for (const [index, person] of people.entries()) {
      const seatNumber = index + 1;
      await client.query(
        `INSERT INTO lunch_reservations
          (seat_key, table_id, seat_number, name, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          lunchSeatKey(tableId, seatNumber),
          tableId,
          seatNumber,
          person.name,
          person.note,
          person.created_at,
        ],
      );
    }
  };

  await seat(b.id, aPeople);
  await seat(a.id, bPeople);

  await client.query("COMMIT");
  return Response.json({
    ok: true,
    swapped: { [a.id]: aPeople.length, [b.id]: bPeople.length },
  });
}

/** 把一批已經劃走的位子整批搬到另一張桌子，姓名與備註跟著走。 */
export async function PATCH(request: Request) {
  const client = await pool.connect();
  try {
    await ensureLunchSchema();
    const payload = (await request.json()) as {
      seatKeys?: string[];
      targetTableId?: string;
      /** 兩張桌子的人整批對調。 */
      swapTables?: { a?: string; b?: string };
      password?: string;
    };
    if (!isCorrectPassword(payload.password)) return passwordRejected();

    if (payload.swapTables) {
      return await swapWholeTables(
        client,
        String(payload.swapTables.a ?? ""),
        String(payload.swapTables.b ?? ""),
      );
    }
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
      password?: string;
    };
    if (!isCorrectPassword(payload.password)) return passwordRejected();
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
