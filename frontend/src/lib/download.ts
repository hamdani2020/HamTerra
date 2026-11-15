/**
 * "Download JSON" for a report (Requirement 15.11): the Backend's response text, unchanged,
 * in a file named with the report ID.
 */
export function reportFileName(reportId: string): string {
  return `report-${reportId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
}

export function reportBlob(raw: string): Blob {
  return new Blob([raw], { type: "application/json" });
}

/** Saves `blob` as `fileName` through a temporary object URL, which is released afterwards. */
export function saveBlob(blob: Blob, fileName: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
