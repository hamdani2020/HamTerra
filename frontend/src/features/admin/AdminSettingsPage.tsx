import { useState } from "react";

import { RegionError, RegionSkeleton } from "@/components/common/RegionState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/core/api/errors";
import { formatDateTime } from "@/lib/format";
import { ADMIN_TEXT, mapFieldErrors, settingRangeText } from "@/lib/messages";
import { PAGE_TITLE } from "@/lib/pageTitles";
import { SETTING_DESCRIPTIONS, validateSetting } from "@/lib/settings";
import type { SettingItem } from "@/types/api";

import { useAdminSettings, useSaveSetting } from "./adminHooks";
import { alertClass, noticeClass } from "./filters";

function valueText(value: number | boolean): string {
  if (typeof value === "boolean") return value ? ADMIN_TEXT.on : ADMIN_TEXT.off;
  return String(value);
}

/** The Backend constraint message for a 422: the `value` field reason, else the envelope message (19.5). */
function constraintMessage(error: ApiError): string {
  const { fieldErrors, formErrors } = mapFieldErrors(error.details, ["value"]);
  return fieldErrors.value ?? formErrors[0] ?? error.message;
}

/**
 * One setting (Requirements 19.2 to 19.7). Validation runs on every change, so a field error
 * shows at once (19.3). The stored value is shown separately and changes only on a 200.
 */
function SettingRow({ item, onUnknown }: { item: SettingItem; onUnknown: () => void }): JSX.Element {
  const [raw, setRaw] = useState<string | boolean>(() => (typeof item.value === "boolean" ? item.value : String(item.value)));
  const [serverError, setServerError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ kind: "notice" | "alert"; text: string } | null>(null);
  const save = useSaveSetting(item.key);
  const result = validateSetting(item, raw);
  const fieldError = result.ok ? serverError : result.error;
  const inputId = `setting-${item.key}`;
  const errorId = `${inputId}-error`;
  const rangeId = `${inputId}-range`;
  const description = SETTING_DESCRIPTIONS[item.key];

  function edit(value: string | boolean): void {
    setRaw(value);
    setServerError(null);
    setOutcome(null);
  }

  function submit(): void {
    if (!result.ok) return;
    setOutcome(null);
    setServerError(null);
    save.mutate(result.value, {
      onSuccess: (saved) => {
        setRaw(typeof saved.value === "boolean" ? saved.value : String(saved.value));
        setOutcome({ kind: "notice", text: ADMIN_TEXT.settingSaved });
      },
      onError: (e) => {
        if (e instanceof ApiError && e.status === 422) {
          // The edit stays in the input for correction (19.5).
          setServerError(constraintMessage(e));
        } else if (e instanceof ApiError && e.status === 404) {
          // The page shows the notice, because the row may leave the reloaded list (19.6).
          onUnknown();
        } else {
          setOutcome({ kind: "alert", text: ADMIN_TEXT.settingFailed });
        }
      },
    });
  }

  const describedBy = [item.type === "boolean" ? null : rangeId, fieldError ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <li className="space-y-3 rounded-lg border bg-card p-4 shadow">
      <div className="space-y-1">
        <h2 className="font-mono text-base font-semibold text-foreground [overflow-wrap:anywhere]">{item.key}</h2>
        {/* Unknown keys show their name only (19.8). */}
        {description && <p className="text-sm text-ink-muted">{description}</p>}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        <dt className="text-ink-muted">{ADMIN_TEXT.value}</dt>
        <dd className="font-medium tabular-nums">{valueText(item.value)}</dd>
        <dt className="text-ink-muted">{ADMIN_TEXT.type}</dt>
        <dd>{item.type}</dd>
        <dt className="text-ink-muted">{ADMIN_TEXT.defaultValue}</dt>
        <dd className="tabular-nums">{valueText(item.default)}</dd>
        {item.type !== "boolean" && (
          <>
            <dt className="text-ink-muted">{ADMIN_TEXT.range_}</dt>
            <dd className="tabular-nums">{settingRangeText(item.min, item.max)}</dd>
          </>
        )}
        <dt className="text-ink-muted">{ADMIN_TEXT.updatedBy}</dt>
        <dd className="[overflow-wrap:anywhere]">{item.updated_by ?? ADMIN_TEXT.never}</dd>
        <dt className="text-ink-muted">{ADMIN_TEXT.updatedAt}</dt>
        <dd>{item.updated_at ? formatDateTime(item.updated_at) : ADMIN_TEXT.never}</dd>
      </dl>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor={inputId}>{`${ADMIN_TEXT.newValue}: ${item.key}`}</Label>
          {item.type === "boolean" ? (
            <div className="flex min-h-11 items-center gap-3">
              <Switch id={inputId} checked={raw === true || raw === "true"} disabled={save.isPending} aria-describedby={describedBy} onCheckedChange={(v) => edit(v)} />
              <span className="text-sm">{raw === true || raw === "true" ? ADMIN_TEXT.on : ADMIN_TEXT.off}</span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Input
                id={inputId}
                type="number"
                inputMode="decimal"
                step={item.type === "integer" ? 1 : "any"}
                className="w-40"
                value={typeof raw === "string" ? raw : ""}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={describedBy}
                onChange={(e) => edit(e.target.value)}
              />
              <span id={rangeId} className="text-sm text-ink-muted">
                {settingRangeText(item.min, item.max)}
              </span>
            </div>
          )}
        </div>
        <Button type="button" className="h-11 sm:h-10" disabled={!result.ok || save.isPending} aria-label={`${ADMIN_TEXT.save}: ${item.key}`} onClick={submit}>
          {save.isPending ? ADMIN_TEXT.saving : ADMIN_TEXT.save}
        </Button>
      </div>
      {fieldError && (
        <p id={errorId} className="text-sm font-medium text-status-error">
          {fieldError}
        </p>
      )}
      {outcome && (
        <p role={outcome.kind === "notice" ? "status" : "alert"} className={outcome.kind === "notice" ? noticeClass : alertClass}>
          {outcome.text}
        </p>
      )}
    </li>
  );
}

/**
 * Application settings (Requirement 19). Only keys the Backend returns are editable (19.9);
 * there is no free key entry.
 */
export function AdminSettingsPage(): JSX.Element {
  const settings = useAdminSettings();
  const [unknown, setUnknown] = useState(false);
  let body: JSX.Element;
  if (settings.isError && !settings.data) {
    body = <RegionError error={settings.error} context={ADMIN_TEXT.settingsError} onRetry={() => void settings.refetch()} retrying={settings.isFetching} />;
  } else if (!settings.data) {
    body = <RegionSkeleton rows={6} />;
  } else {
    body = (
      <ul className="space-y-3">
        {settings.data.items.map((item) => (
          <SettingRow
            key={item.key}
            item={item}
            onUnknown={() => {
              setUnknown(true);
              void settings.refetch();
            }}
          />
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-4">
      <h1 tabIndex={-1} className="text-2xl font-semibold text-foreground">
        {PAGE_TITLE.adminSettings}
      </h1>
      {unknown && (
        <p role="alert" className={alertClass}>
          {ADMIN_TEXT.settingUnknown}
        </p>
      )}
      <section aria-label={ADMIN_TEXT.settingsCaption} aria-busy={settings.isFetching} className="min-w-0">
        {body}
      </section>
    </div>
  );
}
