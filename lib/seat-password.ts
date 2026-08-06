/**
 * 修改既有座位（取消、換位、整批換桌、整桌對調）需要的確認密碼。
 *
 * 這個模組只能在伺服器端（route handler）使用，不要從前端元件 import，
 * 否則密碼會被打包進瀏覽器的 JS。
 *
 * 部署時可以用環境變數 SEAT_EDIT_PASSWORD 覆蓋預設值。
 */
export const SEAT_EDIT_PASSWORD =
  process.env.SEAT_EDIT_PASSWORD?.trim() || "870821";

export function isCorrectPassword(input: unknown) {
  return typeof input === "string" && input.trim() === SEAT_EDIT_PASSWORD;
}

/** 密碼不對時統一回這個回應。 */
export function passwordRejected() {
  return Response.json(
    { error: "確認密碼不正確，請再試一次。" },
    { status: 401 },
  );
}
