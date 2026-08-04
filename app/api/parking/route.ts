import { ensureLunchSchema, pool } from "@/lib/db";
import { isValidPlate, normalizePlate } from "@/lib/plate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlateRow = {
  plate: string;
  name: string;
  note: string;
  created_at: Date | string;
};

function serialize(row: PlateRow) {
  return {
    plate: row.plate,
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
    const result = await pool.query<PlateRow>(
      `SELECT plate, name, note, created_at
       FROM parking_plates
       ORDER BY created_at`,
    );
    return Response.json({ plates: result.rows.map((row) => serialize(row)) });
  } catch (error) {
    console.error("GET /api/parking failed", error);
    return Response.json(
      { error: "無法讀取車號名單，請稍後再試。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await ensureLunchSchema();
    const payload = (await request.json()) as {
      plate?: string;
      name?: string;
      note?: string;
    };
    const plate = normalizePlate(payload.plate ?? "");
    const name = payload.name?.trim() ?? "";
    const note = payload.note?.trim() ?? "";

    if (!isValidPlate(plate)) {
      return Response.json(
        { error: "車號格式看起來不太對，例如：ABC-1234 或 1234-AB。" },
        { status: 400 },
      );
    }
    if (!name || name.length > 30 || note.length > 40) {
      return Response.json(
        { error: "請確認姓名與備註內容。" },
        { status: 400 },
      );
    }

    await pool.query(
      `INSERT INTO parking_plates (plate, name, note) VALUES ($1, $2, $3)`,
      [plate, name, note],
    );
    return Response.json({ ok: true, plate });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (code === "23505") {
      return Response.json({ error: "這個車號已經登記過了。" }, { status: 409 });
    }
    console.error("POST /api/parking failed", error);
    return Response.json({ error: "登記失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureLunchSchema();
    const payload = (await request.json()) as { plate?: string };
    const plate = normalizePlate(payload.plate ?? "");

    if (!isValidPlate(plate)) {
      return Response.json({ error: "無效的車號" }, { status: 400 });
    }

    await pool.query("DELETE FROM parking_plates WHERE plate = $1", [plate]);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/parking failed", error);
    return Response.json({ error: "刪除失敗" }, { status: 500 });
  }
}
