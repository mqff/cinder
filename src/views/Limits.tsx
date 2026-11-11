import { useEffect, useMemo, useState } from "react";
import { AppDialog } from "@/components/AppDialog";
import { Choice } from "@/components/Choice";
import { ExpandableList } from "@/components/ExpandableList";
import { Empty, Panel, Metadata } from "@/components/Primitives";
import type { LimitsProfile, LimitsResult } from "@/lib/types";
import { available, nextRefill, poolWindows, remaining, resetLabel, windowPace } from "@/lib/limits";
import { sourceLabel } from "@/lib/navigation";
import { CursorAccountUsage } from "@/components/CursorAccountUsage";
import { SensitiveText } from "@/components/SensitiveText";
import { fmt } from "@/lib/format";

const supported = ["codex", "claude", "cursor", "grok", "opencode", "antigravity"];
const pct = (value: number) => `${Math.round(value * 10) / 10}%`;
const localTime = (value: string | number) =>
  new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function Limits({
  data,
  busy,
  now,
  refresh,
  reset
}: {
  data: LimitsResult | null;
  busy: boolean;
  now: number;
  refresh: () => Promise<void>;
  reset: (id: string, requestId: string, resetKind?: string) => Promise<void>;
}) {
  const [provider, setProvider] = useState("");
  const [accountId, setAccountId] = useState("");
  const [confirm, setConfirm] = useState<{
    id: string;
    requestId: string;
    resetKind?: string;
    description?: string;
  } | null>(null);
  const [resetKind, setResetKind] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetPending, setResetPending] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const accounts = data?.accounts || [];
  useEffect(() => {
    if (confirm && data && !accounts.some((item) => item.id === confirm.id)) {
      setConfirm(null);
      setAccountId("");
      setResetError("");
    }
  }, [accounts, confirm, data]);
  const providers = useMemo(() => [...new Set(accounts.map((item) => item.provider))], [accounts]);
  const groups = useMemo(
    () =>
      providers
        .filter((id) => !provider || provider === id)
        .map((id) => ({ id, accounts: accounts.filter((item) => item.provider === id && item.windows.length) }))
        .filter((group) => group.accounts.length),
    [accounts, provider, providers]
  );
  const unavailable = accounts.filter((item) => !item.windows.length && (!provider || provider === item.provider));
  const active = accounts.find((item) => item.id === accountId);
  const resetting = accounts.find((item) => item.id === confirm?.id);
  async function consume() {
    if (!confirm) return;
    setResetPending(true);
    setResetError("");
    try {
      await reset(confirm.id, confirm.requestId, confirm.resetKind);
      setConfirm(null);
    } catch (error) {
      setResetError(
        error instanceof Error ? error.message : "The reset could not be confirmed. Retry with the same request."
      );
    } finally {
      setResetPending(false);
    }
  }
  return (
    <div className="view-stack limits-view">
      <div className="limits-toolbar">
        <p className="note">Account allowances from your connected tools. Checked at most every 5 minutes.</p>
        <div className="inline-controls">
          <Choice
            label="Limit providers"
            value={provider}
            onChange={setProvider}
            options={[
              { value: "", label: "All providers" },
              ...providers.map((id) => ({ value: id, label: sourceLabel(id) }))
            ]}
          />
          <button className="button" onClick={() => setProfilesOpen(true)}>
            Accounts
          </button>
        </div>
      </div>
      {!data && (
        <Empty title={busy ? "Checking account limits…" : "No limits loaded"}>
          Open a supported tool and sign in, then refresh.
        </Empty>
      )}
      {data?.warning && <p className="notice">{data.warning}</p>}
      {data && !accounts.length && (
        <Empty title="No connected accounts">Sign in to a supported tool or add its account directory.</Empty>
      )}
      <ExpandableList items={groups}>
        {(visible) => (
          <div className="limits-grid">
            {visible.map((group) => {
              const pools = poolWindows(group.accounts, now);
              const orderedAccounts = pools[0]?.segments.map((item) => item.account) || group.accounts;
              const credits = group.accounts.reduce((sum, item) => sum + (item.resetCredits?.available || 0), 0);
              return (
                <section className="quota-card" key={group.id}>
                  <header className="quota-heading">
                    <div>
                      <h2>{sourceLabel(group.id)}</h2>
                      <p className="quota-account-summary">
                        <span>
                          {group.accounts.length} {group.accounts.length === 1 ? "account" : "accounts"}
                        </span>
                        {group.accounts.length === 1 && group.accounts[0].plan && (
                          <span className="quota-plan">{fmt.plan(group.accounts[0].plan)}</span>
                        )}
                      </p>
                    </div>
                    {credits > 0 && (
                      <span className="quota-tag">
                        {credits} reset {credits === 1 ? "credit" : "credits"}
                      </span>
                    )}
                  </header>
                  <ExpandableList items={pools}>
                    {(windows) => (
                      <div className="quota-windows">
                        {windows.map((pool) => (
                          <div className="quota-window" key={pool.id}>
                            <div className="quota-label">
                              <span>{pool.label}</span>
                              <strong>
                                {pool.balance === null ? pct(pool.remaining) : fmt.usd(pool.balance)}{" "}
                                <small>left</small>
                              </strong>
                            </div>
                            <div
                              className="quota-pool"
                              role="group"
                              aria-label={`${pool.label}: ${pct(pool.remaining)} remaining across ${pool.segments.length} accounts`}
                            >
                              {pool.segments.map(({ account, window }) => {
                                if (!window)
                                  return (
                                    <span
                                      key={account.id}
                                      className="quota-gap"
                                      title={`Account ${group.accounts.indexOf(account) + 1}\nThis window is not reported`}
                                    />
                                  );
                                const value = available(account, window);
                                const refill = nextRefill(account, window, now);
                                const pace =
                                  !account.stale && value === remaining(window) ? windowPace(window, now) : null;
                                return (
                                  <button
                                    key={account.id}
                                    className={`quota-segment ${account.stale ? "stale" : ""} ${value <= 10 ? "low" : ""}`}
                                    aria-label={`Inspect ${sourceLabel(group.id)} account ${group.accounts.indexOf(account) + 1}, ${window.label}, ${pct(value)} remaining`}
                                    title={[
                                      `Account ${group.accounts.indexOf(account) + 1}`,
                                      `Remaining: ${pct(value)}`,
                                      account.stale ? "Last known allowance" : "",
                                      pace ? `Pace: ${pace.label}\nWindow time left: ${pct(pace.timeLeft)}` : ""
                                    ]
                                      .filter(Boolean)
                                      .join("\n")}
                                    onClick={() => setAccountId(account.id)}
                                  >
                                    <span className="quota-fill" style={{ width: `${value}%` }} />
                                    {refill && refill.time === pool.refill?.time && (
                                      <span
                                        className="quota-refill"
                                        style={{ left: `${value}%`, width: `${refill.restored}%` }}
                                      />
                                    )}
                                    {pace && (
                                      <span
                                        className="quota-pace"
                                        style={{ left: `clamp(2px, ${pace.timeLeft}%, calc(100% - 3px))` }}
                                      />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="quota-caption">
                              {pool.segments.some((item) => item.account.stale) ? (
                                <span>Showing last known allowance after a failed check</span>
                              ) : pool.balance !== null &&
                                pool.segments.every(({ window }) => !window || window.scope === "paid-credits") ? (
                                <span>Paid balance only</span>
                              ) : pool.refill ? (
                                <span title={localTime(pool.refill.time)}>
                                  {resetLabel(pool.refill.time, now)} <b>+{pct(pool.refill.restored)}</b>
                                </span>
                              ) : (
                                <span>
                                  {pool.segments.some(({ window }) => window?.resetsAt)
                                    ? resetLabel(
                                        pool.segments.find(({ window }) => window?.resetsAt)?.window?.resetsAt || "",
                                        now
                                      )
                                    : "Reset time not reported"}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ExpandableList>
                  {group.accounts.length > 1 && (
                    <p className="note quota-normalized">
                      Each segment represents one account. Percentages give each account equal weight.
                    </p>
                  )}
                  <div className="quota-account-list">
                    <ExpandableList items={orderedAccounts}>
                      {(visible) =>
                        visible.map((item) => (
                          <div className="quota-account-row" key={item.id}>
                            <AccountLabel value={item.label} />
                            {item.stale && <small className="quota-account-status">Check failed</small>}
                            <button
                              className="quota-account-link"
                              aria-label={`Inspect ${sourceLabel(group.id)} account ${group.accounts.indexOf(item) + 1}`}
                              onClick={() => setAccountId(item.id)}
                            >
                              Details
                            </button>
                          </div>
                        ))
                      }
                    </ExpandableList>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </ExpandableList>
      {unavailable.length > 0 && (
        <Panel title="Other detected accounts" hint="No quota reported">
          <ExpandableList items={unavailable}>
            {(visible) => (
              <div className="unavailable-accounts">
                {visible.map((item) => (
                  <div key={item.id}>
                    <strong>{sourceLabel(item.provider)}</strong>
                    <span>{item.message || "No allowance available."}</span>
                    <div className="account-row-actions">
                      {item.status === "error" && <small>Check failed</small>}
                      {supported.includes(item.provider) && (
                        <button
                          className="button"
                          aria-label={`Inspect ${sourceLabel(item.provider)} account`}
                          onClick={() => setAccountId(item.id)}
                        >
                          Details
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ExpandableList>
        </Panel>
      )}
      {active && !confirm && (
        <AppDialog title={`${sourceLabel(active.provider)} account`} onClose={() => setAccountId("")}>
          <div className="view-stack account-details">
            <div className="account-identity">
              <strong>
                <AccountLabel value={active.label} />
              </strong>
              <span>{active.plan ? fmt.plan(active.plan) : "Plan not reported"}</span>
            </div>
            <dl className="account-meta">
              {!!active.locations?.length && (
                <div>
                  <dt>Account directories</dt>
                  <dd>
                    {active.locations.map((location) => (
                      <code key={location}>
                        <SensitiveText value={location} label="Account directory" />
                      </code>
                    ))}
                  </dd>
                </div>
              )}
              <div>
                <dt>Last check</dt>
                <dd>{localTime(active.checkedAt)}</dd>
              </div>
              {active.lastSuccessAt && (
                <div>
                  <dt>Last successful check</dt>
                  <dd>{localTime(active.lastSuccessAt)}</dd>
                </div>
              )}
              <div>
                <dt>Usage access</dt>
                <dd>
                  {active.ordinaryUsageAllowed === undefined
                    ? "Not reported"
                    : active.ordinaryUsageAllowed
                      ? "Allowed"
                      : "Currently blocked"}
                </dd>
              </div>
            </dl>
            {active.message && <p className={`notice ${active.status === "error" ? "error" : ""}`}>{active.message}</p>}
            <ExpandableList items={active.windows}>
              {(visible) => (
                <div className="account-window-list">
                  {visible.map((window) => {
                    const pace = active.stale ? null : windowPace(window, now);
                    return (
                      <div key={window.id}>
                        <div className="quota-label">
                          <span>{window.label}</span>
                          <strong>
                            {window.unit === "USD" &&
                            window.totalAmount !== undefined &&
                            window.usedAmount !== undefined
                              ? fmt.usd(Math.max(0, window.totalAmount - window.usedAmount))
                              : pct(remaining(window))}{" "}
                            left
                          </strong>
                        </div>
                        <progress max="100" value={remaining(window)} aria-label={`${window.label} remaining`} />
                        {pace && (
                          <div className="quota-window-meta">
                            <Metadata
                              items={[
                                { label: "Pace", value: pace.label },
                                { label: "Window time left", value: pct(pace.timeLeft) }
                              ]}
                            />
                          </div>
                        )}
                        {available(active, window) !== remaining(window) && (
                          <p className="note">Blocked by an exhausted weekly or monthly allowance.</p>
                        )}
                        {window.unit && (
                          <p className="note">
                            ${window.usedAmount?.toFixed(2)} used of ${window.totalAmount?.toFixed(2)}
                          </p>
                        )}
                        <div className="quota-window-meta">
                          {window.resetsAt ? (
                            <Metadata
                              items={[
                                { label: "Reset", value: resetLabel(window.resetsAt, now) },
                                {
                                  label: "Local time",
                                  value: <time dateTime={window.resetsAt}>{localTime(window.resetsAt)}</time>
                                },
                                ...(window.resetSource === "schedule" ? [{ label: "Source", value: "Scheduled" }] : [])
                              ]}
                            />
                          ) : (
                            <p className="note">Reset time not reported</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ExpandableList>
            {active.resetCredits && (
              <div className="reset-credit-box">
                <div>
                  <strong>
                    {active.resetCredits.available} banked reset{" "}
                    {active.resetCredits.available === 1 ? "credit" : "credits"}
                  </strong>
                  <p className="note">
                    {active.resetCredits.nextExpiresAt
                      ? `Next expires ${localTime(active.resetCredits.nextExpiresAt)}`
                      : "Expiration not reported"}
                  </p>
                </div>
                {!!active.resetCredits.options?.length && (
                  <Choice
                    label="Reset credit type"
                    value={
                      active.resetCredits.options.some((item) => item.kind === resetKind)
                        ? resetKind
                        : active.resetCredits.options[0].kind
                    }
                    onChange={setResetKind}
                    options={active.resetCredits.options.map((item) => ({
                      value: item.kind,
                      label: `${item.label} (${item.available} available)`
                    }))}
                  />
                )}
                <button
                  className="button"
                  disabled={busy || active.stale || !active.resetCredits.canUse || active.resetCredits.available < 1}
                  onClick={() => {
                    const option =
                      active.resetCredits?.options?.find((item) => item.kind === resetKind) ||
                      active.resetCredits?.options?.[0];
                    setConfirm({
                      id: active.id,
                      requestId: crypto.randomUUID(),
                      resetKind: option?.kind,
                      description: option?.description
                    });
                    setResetError("");
                  }}
                >
                  Use a reset credit
                </button>
              </div>
            )}
            {active.provider === "cursor" && <CursorAccountUsage key={active.id} accountId={active.id} />}
          </div>
        </AppDialog>
      )}
      {confirm && resetting && (
        <AppDialog
          title="Use one reset credit?"
          closeDisabled={resetPending}
          onClose={() => {
            if (!resetPending) setConfirm(null);
          }}
        >
          <div className="view-stack">
            <p>
              Apply one banked reset credit to{" "}
              <strong>
                <AccountLabel value={resetting.label} />
              </strong>
              . This consumes a finite credit on this provider account.
            </p>
            <p className="note">
              {confirm.description || "The provider decides which allowance is restored."} Cinder checks the account and
              refreshes its limits after the request.
            </p>
            {resetError && (
              <p className="notice error" role="alert">
                {resetError}
              </p>
            )}
            <div className="inline-controls">
              <button className="button" disabled={resetPending} onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button className="button primary" disabled={busy || resetPending} onClick={() => void consume()}>
                {resetPending
                  ? "Applying reset…"
                  : busy
                    ? "Checking account…"
                    : resetError
                      ? "Retry same reset"
                      : "Use one credit"}
              </button>
            </div>
          </div>
        </AppDialog>
      )}
      {profilesOpen && <AccountProfiles onClose={() => setProfilesOpen(false)} onChange={refresh} />}
    </div>
  );
}

function AccountProfiles({ onClose, onChange }: { onClose: () => void; onChange: () => Promise<void> }) {
  const [profiles, setProfiles] = useState<LimitsProfile[]>([]);
  const [provider, setProvider] = useState("codex");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void window.cinder
      ?.limitsProfiles()
      .then(setProfiles)
      .catch(() => setError("Account directories could not be loaded."));
  }, []);
  async function change(profile?: LimitsProfile) {
    if (!window.cinder) return;
    setBusy(true);
    setError("");
    try {
      setProfiles(
        await (profile ? window.cinder.removeLimitsProfile(profile) : window.cinder.addLimitsProfile(provider))
      );
      await onChange();
    } catch {
      setError("The account directory could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppDialog title="Account directories" onClose={onClose}>
      <div className="view-stack">
        <p className="note">
          Default tool locations are detected automatically. Add another existing account directory to pool its
          allowance. Credentials stay in the tool’s directory.
        </p>
        <div className="inline-controls">
          <Choice
            label="Account provider"
            value={provider}
            onChange={setProvider}
            options={supported.map((id) => ({ value: id, label: sourceLabel(id) }))}
          />
          <button className="button" disabled={busy} onClick={() => void change()}>
            Add account directory
          </button>
        </div>
        {error && <p className="notice error">{error}</p>}
        <ExpandableList items={profiles}>
          {(visible) => (
            <div className="profile-list">
              {visible.map((profile) => (
                <div key={`${profile.provider}:${profile.root}`}>
                  <div>
                    <strong>{sourceLabel(profile.provider)}</strong>
                    <code>
                      <SensitiveText value={profile.root} label="Account directory" />
                    </code>
                  </div>
                  <button className="button" disabled={busy} onClick={() => void change(profile)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </ExpandableList>
        <p className="note">
          Removing a directory here only removes Cinder’s reference. The account and its files remain on disk.
        </p>
      </div>
    </AppDialog>
  );
}

function AccountLabel({ value }: { value: string }) {
  return value.includes("@") ? <SensitiveText value={value} label="Account email" /> : <span>{value}</span>;
}
