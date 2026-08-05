import type { Metadata } from "next";
import ImportPanel from "./import-panel";

export const metadata: Metadata = {
  title: "0807 午餐｜批次匯入名單",
  description: "貼上名單依課別自動排位，寫入後仍可自行換位。",
};

export default function LunchImportPage() {
  return <ImportPanel />;
}
