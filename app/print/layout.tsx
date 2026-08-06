import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./print.css";

export const metadata: Metadata = {
  title: "0807 員工旅遊座位表",
};

export default function PrintLayout({ children }: { children: ReactNode }) {
  return children;
}
