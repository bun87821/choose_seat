/** 車號統一成大寫、去除空白、把全形連字號換成半形，方便餐廳核對並避免重複登記。 */
export function normalizePlate(input: string) {
  return input
    .toUpperCase()
    .replaceAll(/[\s　]/g, "")
    .replaceAll(/[—–－ー]/g, "-");
}

export const PLATE_PATTERN = /^[A-Z0-9]{2,6}-?[A-Z0-9]{2,6}$/;

export function isValidPlate(plate: string) {
  return PLATE_PATTERN.test(plate);
}
