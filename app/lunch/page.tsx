import type { Metadata } from "next";
import LunchPicker from "./lunch-picker";

export const metadata: Metadata = {
  title: "0807 午餐｜饗 A JOY 座位選位",
  description: "0807 午餐座位選位，並登記車號折抵停車費。",
};

export default function LunchPage() {
  return <LunchPicker />;
}
