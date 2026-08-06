"use client";

import { useCallback, useEffect, useState } from "react";

export function usePrintReservations<T>(endpoint: string) {
  const [reservations, setReservations] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const data = (await response.json()) as {
        reservations?: T[];
        error?: string;
      };
      if (!response.ok || !data.reservations) {
        throw new Error(data.error || "無法讀取最新座位資料");
      }
      setReservations(data.reservations);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "無法讀取最新座位資料",
      );
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    // Initial API synchronization for the printable snapshot.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return {
    reservations,
    loading,
    error,
    reload: () => void load(),
  };
}

export function formatTaipeiTimestamp(date: Date) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function PrintToolbar({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="print-toolbar">
      <div>
        <b>A4 橫式列印版</b>
        <span>
          {loading
            ? "正在讀取最新座位資料…"
            : error || "資料已更新，可直接列印或另存 PDF"}
        </span>
      </div>
      {error ? (
        <button type="button" onClick={onRetry}>
          重新載入
        </button>
      ) : !loading ? (
        <button type="button" onClick={() => window.print()}>
          列印／另存 PDF
        </button>
      ) : null}
    </div>
  );
}
