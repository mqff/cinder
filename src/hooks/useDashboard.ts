import { useCallback, useEffect, useRef, useState } from "react";
import type { CallsResult, CollectResult, ScanProgress, SnapshotInfo, PricingRule } from "@/lib/types";
export function useDashboard() {
  const [usage, setUsage] = useState<CollectResult | null>(null);
  const [calls, setCalls] = useState<CallsResult | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotInfo | null>(null);
  const [phase, setPhase] = useState<"boot" | "gate" | "ready">("boot");
  const [busy, setBusy] = useState(false),
    [callsBusy, setCallsBusy] = useState(false);
  const [error, setError] = useState("");
  const [callsError, setCallsError] = useState("");
  const [progress, setProgress] = useState<ScanProgress>({ done: 0, total: 0, label: "" });
  const active = useRef(false),
    callsActive = useRef(false),
    mounted = useRef(true),
    hasUsage = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () =>
      window.cinder?.onScanProgress((value) => {
        if (mounted.current) setProgress(value);
      }),
    []
  );
  const refreshCalls = useCallback(async () => {
    if (!window.cinder || callsActive.current) return;
    callsActive.current = true;
    setCallsBusy(true);
    setCallsError("");
    try {
      const result = await window.cinder.calls();
      if (!mounted.current) return;
      if (result.error) setCallsError(result.error);
      else if (!result.cancelled) setCalls(result);
      if (result.warning) setCallsError(result.warning);
    } catch (cause) {
      if (mounted.current) setCallsError(String(cause));
    } finally {
      callsActive.current = false;
      if (mounted.current) setCallsBusy(false);
    }
  }, []);
  const scan = useCallback(async () => {
    if (active.current) return;
    if (!window.cinder) {
      setError("Desktop connection unavailable.");
      setPhase("ready");
      return;
    }
    active.current = true;
    setBusy(true);
    setError("");
    setPhase("ready");
    setProgress({ done: 0, total: 0, label: "" });
    try {
      const result = await window.cinder.collect();
      if (!mounted.current) return;
      if (result.cancelled) {
        if (!hasUsage.current) setPhase("gate");
        return;
      }
      if (result.error) {
        setError(result.error);
        return;
      }
      hasUsage.current = true;
      setUsage(result);
      if (result.warning) setError(result.warning);
      void refreshCalls();
    } catch (cause) {
      if (mounted.current) setError(String(cause));
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [refreshCalls]);
  const restore = useCallback(async () => {
    try {
      const result = await window.cinder?.snapshotUsage();
      if (!mounted.current) return;
      if (!result) {
        void scan();
        return;
      }
      hasUsage.current = true;
      setUsage(result);
      setPhase("ready");
      setError("");
      const savedCalls = await window.cinder?.snapshotCalls();
      if (mounted.current) {
        if (savedCalls) setCalls(savedCalls);
        else void refreshCalls();
      }
    } catch (cause) {
      if (mounted.current) {
        setError(String(cause));
        setPhase("gate");
      }
    }
  }, [scan, refreshCalls]);
  useEffect(() => {
    let alive = true;
    window.cinder
      ?.snapshotInfo()
      .then((info) => {
        if (!alive) return;
        setSnapshot(info);
        if (info) setPhase("gate");
        else void scan();
      })
      .catch((cause) => {
        if (alive) {
          setError(String(cause));
          setPhase("gate");
        }
      });
    if (!window.cinder) {
      setPhase("ready");
      setError("Desktop connection unavailable.");
    }
    return () => {
      alive = false;
    };
  }, [scan]);
  const cancel = useCallback(() => {
    void window.cinder?.cancelScan().catch((cause) => {
      if (mounted.current) setError(String(cause));
    });
  }, []);
  const savePricing = useCallback(async (rules: PricingRule[]) => {
    if (!window.cinder || active.current) throw new Error("Wait for the current usage scan to finish.");
    active.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await window.cinder.savePricing(rules);
      if (result.error || result.cancelled)
        throw new Error(
          result.error || "Pricing was saved, but the scan was cancelled. Refresh usage to finish recalculating."
        );
      hasUsage.current = true;
      setUsage(result);
      setPhase("ready");
      if (result.warning) {
        setError(result.warning);
        throw new Error(`Pricing was saved, but recalculation was incomplete. ${result.warning}`);
      }
    } finally {
      active.current = false;
      setBusy(false);
    }
  }, []);
  return {
    usage,
    calls,
    snapshot,
    phase,
    busy,
    callsBusy,
    error,
    callsError,
    progress,
    scan,
    restore,
    cancel,
    refreshCalls,
    savePricing
  };
}
