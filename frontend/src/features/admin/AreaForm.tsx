import { type ChangeEvent, type FormEvent, lazy, Suspense, useMemo, useState } from "react";

import { FormField } from "@/components/common/FormField";
import { RegionSkeleton } from "@/components/common/RegionState";
import { VerbatimText } from "@/components/common/VerbatimText";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/core/api/errors";
import { diffAreaForm, validateAreaFields, type AreaFieldErrors } from "@/lib/areaForm";
import { checkGeoJsonFile, validateGeoJsonInput, type GeoJsonResult } from "@/lib/geojson";
import { ADMIN_AREA_TEXT, describeError, errorText, GEOJSON_CHECK_TEXT, jsonPositionText, mapFieldErrors } from "@/lib/messages";
import type { Area, AreaCreateRequest, AreaUpdateRequest } from "@/types/api";

import { useCreateArea, useUpdateArea } from "./areaHooks";

// The preview reuses the area page's mini map, so MapLibre loads only when the form opens.
const PreviewMap = lazy(() => import("@/features/areas/AreaMiniMap"));
const noop = () => undefined;

/** File contents as text, through FileReader (supported everywhere the app runs). */
function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

export function geoJsonMessage(result: GeoJsonResult): string | null {
  if (result.ok) return null;
  if (result.check === "json" && result.position !== undefined) return jsonPositionText(result.position);
  return GEOJSON_CHECK_TEXT[result.check];
}

/** Errors that map to a field, and the rest as one form-level message (14.8 to 14.10). */
function backendErrors(error: unknown): { fields: AreaFieldErrors; message: string | null } {
  if (!(error instanceof ApiError)) return { fields: {}, message: describeError(error).body };
  if (error.status === 502 || error.status === 504) return { fields: {}, message: ADMIN_AREA_TEXT.providerFailed };
  if (error.code === "GEOMETRY_OUTSIDE_GHANA" || error.code === "AREA_OUT_OF_RANGE") {
    // AREA_OUT_OF_RANGE uses the Backend message, which states the limit (Gap G3).
    return { fields: { geometry: errorText({ code: error.code, message: error.message }) }, message: null };
  }
  if (error.status === 409) return { fields: { name: ADMIN_AREA_TEXT.duplicateName }, message: null };
  if (error.status === 422) {
    const { fieldErrors, formErrors } = mapFieldErrors(error.details, ["name", "description", "geometry"]);
    return { fields: fieldErrors, message: formErrors.length > 0 ? formErrors.join(" ") : Object.keys(fieldErrors).length ? null : errorText(error) };
  }
  return { fields: {}, message: describeError(error).body };
}

export interface AreaFormProps {
  /** The area to edit, with its geometry; absent to create. */
  area?: Area;
  onSaved: (area: Area) => void;
  onCancel: () => void;
}

/**
 * Create or edit a monitoring area (Requirement 14.2 to 14.12). The browser checks only the
 * GeoJSON structure and coordinate ranges; the Backend checks size, shape and Ghana.
 */
export function AreaForm({ area, onSaved, onCancel }: AreaFormProps): JSX.Element {
  const editing = area !== undefined;
  const original = useMemo(
    () => ({ name: area?.name ?? "", description: area?.description ?? null, geometry: area?.geometry ?? null }),
    [area],
  );
  const [name, setName] = useState(original.name);
  const [description, setDescription] = useState(original.description ?? "");
  const [geometryText, setGeometryText] = useState(area?.geometry ? JSON.stringify(area.geometry, null, 2) : "");
  const [fileError, setFileError] = useState<string | null>(null);
  const [errors, setErrors] = useState<AreaFieldErrors>({});
  const [confirmGeometry, setConfirmGeometry] = useState<AreaUpdateRequest | null>(null);
  const create = useCreateArea();
  const update = useUpdateArea(area?.id ?? "");
  const mutation = editing ? update : create;

  const parsed = geometryText.trim() === "" ? null : validateGeoJsonInput(geometryText);
  const geometry = parsed?.ok ? parsed.geometry : null;
  const changes = editing ? diffAreaForm(original, { name, description, geometry: geometry ?? original.geometry }) : null;
  const geometryInvalid = parsed !== null && !parsed.ok;
  const noChanges = editing && changes !== null && Object.keys(changes).length === 0 && !geometryInvalid;
  const pending = mutation.isPending;
  const failure = mutation.isError ? backendErrors(mutation.error) : { fields: {}, message: null };
  const fieldErrors: AreaFieldErrors = { ...failure.fields, ...errors };

  async function loadFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const check = checkGeoJsonFile(file);
    if (!check.ok) {
      setFileError(check.reason === "size" ? ADMIN_AREA_TEXT.fileTooLarge : ADMIN_AREA_TEXT.fileType);
      return;
    }
    try {
      setGeometryText(await readText(file));
      setFileError(null);
    } catch {
      setFileError(ADMIN_AREA_TEXT.fileRead);
    }
  }

  function send(body: AreaCreateRequest | AreaUpdateRequest): void {
    if (editing) update.mutate(body as AreaUpdateRequest, { onSuccess: onSaved });
    else create.mutate(body as AreaCreateRequest, { onSuccess: onSaved });
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (pending) return;
    const next = validateAreaFields(name, description);
    if (!editing && !parsed) next.geometry = ADMIN_AREA_TEXT.geometryRequired;
    if (parsed && !parsed.ok) next.geometry = geoJsonMessage(parsed) ?? undefined;
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    if (!editing) {
      if (!geometry) return;
      send({ name: name.trim(), description: description.trim() === "" ? null : description, geometry });
      return;
    }
    if (!changes || Object.keys(changes).length === 0) return;
    // A geometry change marks existing observations as stale: confirm first (14.12).
    if (changes.geometry) setConfirmGeometry(changes);
    else send(changes);
  }

  // Rebuilt only when the geometry text changes; the map then refits to the new polygon.
  const previewArea = useMemo<Area | null>(
    () =>
      geometry
        ? {
            id: area?.id ?? "preview",
            name: ADMIN_AREA_TEXT.previewTitle,
            description: null,
            status: "active",
            area_ha: 0,
            geometry,
            external_polygon_id: null,
            latest_observation_date: null,
            created_at: "",
            updated_at: "",
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `geometry` is derived from the text
    [geometryText, area?.id],
  );

  return (
    <form noValidate onSubmit={submit} aria-label={editing ? ADMIN_AREA_TEXT.editTitle : ADMIN_AREA_TEXT.createTitle} className="space-y-4">
      <FormField id="area-name" label={ADMIN_AREA_TEXT.name} hint={ADMIN_AREA_TEXT.nameHint} error={fieldErrors.name}>
        {(control) => <Input {...control} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />}
      </FormField>
      <FormField id="area-description" label={ADMIN_AREA_TEXT.description} hint={ADMIN_AREA_TEXT.descriptionHint} error={fieldErrors.description}>
        {(control) => <Textarea {...control} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </FormField>
      <FormField id="area-geometry" label={ADMIN_AREA_TEXT.geometry} hint={ADMIN_AREA_TEXT.geometryHint} error={fieldErrors.geometry}>
        {(control) => (
          <Textarea {...control} rows={8} className="font-mono text-xs" spellCheck={false} value={geometryText} onChange={(e) => setGeometryText(e.target.value)} />
        )}
      </FormField>
      {parsed && !parsed.ok && !fieldErrors.geometry && (
        <p className="text-sm text-status-error" data-testid="geojson-live-error">
          {geoJsonMessage(parsed)}
        </p>
      )}
      <FormField id="area-file" label={ADMIN_AREA_TEXT.file} hint={ADMIN_AREA_TEXT.fileHint} error={fileError ?? undefined}>
        {(control) => <input {...control} type="file" accept=".geojson,.json" onChange={(e) => void loadFile(e)} className="block text-sm" />}
      </FormField>

      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{ADMIN_AREA_TEXT.previewTitle}</p>
        <p className="text-sm text-ink-muted">{ADMIN_AREA_TEXT.coordinateOrder}</p>
        <p className="text-sm text-ink-muted">{ADMIN_AREA_TEXT.previewNote}</p>
        {previewArea && (
          <Suspense fallback={<RegionSkeleton rows={3} />}>
            <PreviewMap area={previewArea} onReady={noop} />
          </Suspense>
        )}
      </div>

      {pending && (
        <p role="status" aria-busy="true" className="text-sm text-foreground">
          {ADMIN_AREA_TEXT.saving}
        </p>
      )}
      {failure.message && (
        <div role="alert" className="rounded-md border border-status-error bg-status-error-bg p-3 text-status-error">
          <VerbatimText text={failure.message} />
        </div>
      )}
      {noChanges && <p className="text-sm text-ink-muted">{ADMIN_AREA_TEXT.noChanges}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          {ADMIN_AREA_TEXT.cancel}
        </Button>
        <Button type="submit" disabled={pending || noChanges}>
          {editing ? ADMIN_AREA_TEXT.submitEdit : ADMIN_AREA_TEXT.submitCreate}
        </Button>
      </div>

      <AlertDialog open={confirmGeometry !== null} onOpenChange={(open) => !open && setConfirmGeometry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ADMIN_AREA_TEXT.geometryConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{ADMIN_AREA_TEXT.geometryConfirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ADMIN_AREA_TEXT.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmGeometry) send(confirmGeometry);
                setConfirmGeometry(null);
              }}
            >
              {ADMIN_AREA_TEXT.geometryConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
