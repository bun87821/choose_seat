"use client";

/**
 * 前端這一側只負責「跟使用者要密碼、記住、送給後端」，
 * 真正的驗證在 API 端（lib/seat-password.ts），這裡不知道正確答案。
 */
const STORAGE_KEY = "lunchSeatEditPassword";

function readStored() {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStored(value: string) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    // 無痕模式等情況下存不起來，就每次都問。
  }
}

/** 密碼被後端打回票時清掉，下次會重新詢問。 */
export function forgetEditPassword() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上，忽略即可。
  }
}

/**
 * 取得確認密碼；這個瀏覽階段已經輸入過就直接沿用。
 * 回傳空字串代表使用者按了取消。
 */
export function askEditPassword(action: string) {
  const stored = readStored();
  if (stored) return stored;
  const input =
    window.prompt(`${action}需要確認密碼，請輸入：`)?.trim() ?? "";
  if (input) writeStored(input);
  return input;
}

/** 後端回 401 時呼叫，清掉記住的密碼並給一句提示。 */
export function handlePasswordRejection(status: number) {
  if (status === 401) {
    forgetEditPassword();
    return true;
  }
  return false;
}
