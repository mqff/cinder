import { useCallback, useEffect, useRef, useState } from "react";
import type { LimitsResult } from "@/lib/types";

export function useLimits(active: boolean) {
  const [data, setData] = useState<LimitsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    if (!active) return;
    return window.cinder?.onLimitsProgress((result) => {
      if (!pending.current || !Array.isArray(result.accounts)) return;
      setData((previous) => ({
        ...result,
        accounts: [
          ...(previous?.accounts || []).filter((item) => !result.accounts.some((incoming) => incoming.id === item.id)),
          ...result.accounts
        ]
      }));
    });
  }, [active]);
  const load = useCallback(async (force = false) => {
    if (!window.cinder || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await (force ? window.cinder.refreshLimits() : window.cinder.readLimits());
      if (result.error) setError(result.error);
      if (Array.isArray(result.accounts)) setData(result);
    } catch {
      setError("Limits could not be loaded. Try refreshing again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 300000);
    return () => clearInterval(timer);
  }, [active, load]);
  const reset = useCallback(async (accountId: string, requestId: string, resetKind?: string) => {
    if (!window.cinder || pending.current) throw new Error("Wait for the current check to finish.");
    pending.current = true;
    setBusy(true);
    try {
      const result = await window.cinder.useResetCredit({ accountId, requestId, resetKind });
      if (result.error) throw new Error(result.error);
      if (!Array.isArray(result.accounts)) throw new Error("Refresh Limits to confirm the reset result.");
      setData(result);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, []);
  return { data, busy, error, refresh: useCallback(() => load(true), [load]), reset };
}
