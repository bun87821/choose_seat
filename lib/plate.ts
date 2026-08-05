/**
 * 車號一律轉成大寫並去掉連字號、空白等符號後才存檔，
 * 這樣 ABC-1234 與 ABC1234 會被視為同一台車，不會重複登記。
 */
export function normalizePlate(input: string) {
  return input.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
}

export const PLATE_PATTERN = /^[A-Z0-9]{4,10}$/;

export function isValidPlate(plate: string) {
  return PLATE_PATTERN.test(plate);
}

/** 顯示時在英文與數字的交界補回連字號，例如 ABC1234 → ABC-1234、1234AB → 1234-AB。 */
export function formatPlate(plate: string) {
  const match = /^([A-Z]+)(\d+)$/.exec(plate) ?? /^(\d+)([A-Z]+)$/.exec(plate);
  return match ? `${match[1]}-${match[2]}` : plate;
}
