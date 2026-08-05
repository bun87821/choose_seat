import { ensureLunchSchema, pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME = 30;
const MAX_BODY = 300;
/** 一次最多回傳的留言數，太舊的就不撈了。 */
const PAGE_SIZE = 200;

type MessageRow = {
  id: string;
  name: string;
  body: string;
  created_at: Date | string;
};

function serialize(row: MessageRow) {
  return {
    id: String(row.id),
    name: row.name,
    body: row.body,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  };
}

export async function GET() {
  try {
    await ensureLunchSchema();
    // 先取最新的 PAGE_SIZE 筆，再依時間由舊到新排好給前端顯示。
    const result = await pool.query<MessageRow>(
      `SELECT * FROM (
         SELECT id, name, body, created_at
         FROM lunch_messages
         ORDER BY created_at DESC, id DESC
         LIMIT $1
       ) recent
       ORDER BY created_at, id`,
      [PAGE_SIZE],
    );
    return Response.json({ messages: result.rows.map((row) => serialize(row)) });
  } catch (error) {
    console.error("GET /api/messages failed", error);
    return Response.json(
      { error: "無法讀取留言，請稍後再試。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    await ensureLunchSchema();
    const payload = (await request.json()) as { name?: string; body?: string };
    const name = payload.name?.trim() ?? "";
    const body = payload.body?.trim() ?? "";

    if (!name || name.length > MAX_NAME) {
      return Response.json(
        { error: `請填暱稱，最多 ${MAX_NAME} 個字。` },
        { status: 400 },
      );
    }
    if (!body || body.length > MAX_BODY) {
      return Response.json(
        { error: `請填留言內容，最多 ${MAX_BODY} 個字。` },
        { status: 400 },
      );
    }

    const result = await pool.query<MessageRow>(
      `INSERT INTO lunch_messages (name, body)
       VALUES ($1, $2)
       RETURNING id, name, body, created_at`,
      [name, body],
    );
    return Response.json({ ok: true, message: serialize(result.rows[0]) });
  } catch (error) {
    console.error("POST /api/messages failed", error);
    return Response.json({ error: "留言失敗，請稍後再試。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureLunchSchema();
    const payload = (await request.json()) as { id?: string };
    const id = String(payload.id ?? "").trim();

    if (!/^\d+$/.test(id)) {
      return Response.json({ error: "無效的留言編號" }, { status: 400 });
    }

    await pool.query("DELETE FROM lunch_messages WHERE id = $1", [id]);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/messages failed", error);
    return Response.json({ error: "刪除失敗" }, { status: 500 });
  }
}
