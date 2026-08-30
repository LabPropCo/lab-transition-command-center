import { useMemo, useState } from "react";
import type { Vendor } from "../vendors/types";
import type { VendorSourceInput } from "../vendors/api";
import type { Property } from "../types";

// Reads the first worksheet of a .csv, .xlsx, or .xls file into a plain
// string[][] (header row + data rows) via SheetJS — one reading layer for
// every supported format, rather than a hand-rolled CSV-only parser. Cell
// values are coerced to strings; existing downstream code already trims
// and normalizes on read, so behavior for CSV is unchanged.
// Dynamically imported: SheetJS adds a few hundred kB, and every other
// screen in the app should not pay that cost — only loaded the moment a
// user actually opens this import panel.
async function readWorkbookTable(file: File): Promise<string[][]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("That file has no readable worksheet.");
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as unknown[][];
  if (rows.length === 0) throw new Error("That file has no readable worksheet.");
  return rows.map((r) => r.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
}

interface ParsedRow {
  originalName: string;
  notes: string | null;
  matchVendorId: string | null; // exact normalized-name match against the existing transition vendor list
  resolution: "create" | "link" | "skip";
}

const normalize = (s: string) => s.trim().toLowerCase();

export function VendorImport({ properties, existingVendors, onClose, onCreate, onLink, onDone }: {
  properties: Property[];
  existingVendors: Vendor[];
  onClose: () => void;
  onCreate: (name: string, source: VendorSourceInput) => Promise<Vendor>;
  onLink: (vendorId: string, source: VendorSourceInput) => Promise<void>;
  onDone: () => void;
}) {
  const [propertyId, setPropertyId] = useState<string>("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileError, setFileError] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [result, setResult] = useState<{ created: number; linked: number; skipped: number } | null>(null);

  const existingByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of existingVendors) m.set(normalize(v.name), v.id);
    return m;
  }, [existingVendors]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError("");
    readWorkbookTable(file).then((table) => {
      const rawHeader = table[0];
      const header = rawHeader.map((h) => h.trim().toLowerCase());
      const nameIdx = header.findIndex((h) => h === "vendor name" || h === "name" || h === "vendor");
      const notesIdx = header.findIndex((h) => h === "notes" || h === "note");
      if (nameIdx === -1) {
        const found = rawHeader.map((h) => h.trim()).filter(Boolean);
        setFileError(
          "Expected column:\n• Vendor Name\n\n" +
          (found.length > 0 ? `Found:\n${found.map((h) => `• ${h}`).join("\n")}` : "Found: (no header row could be read)"),
        );
        return;
      }
      const parsed: ParsedRow[] = table.slice(1)
        .map((r) => ({ originalName: (r[nameIdx] ?? "").trim(), notes: notesIdx >= 0 ? (r[notesIdx] ?? "").trim() || null : null }))
        .filter((r) => r.originalName)
        .map((r) => {
          const matchVendorId = existingByName.get(normalize(r.originalName)) ?? null;
          return { ...r, matchVendorId, resolution: matchVendorId ? "link" : "create" } as ParsedRow;
        });
      setRows(parsed);
    }).catch((err) => setFileError(err instanceof Error ? err.message : "Could not read that file."));
  }

  function setResolution(i: number, resolution: ParsedRow["resolution"]) {
    setRows((r) => r && r.map((row, idx) => (idx === i ? { ...row, resolution } : row)));
  }

  async function apply() {
    if (!rows) return;
    setApplying(true); setApplyError("");
    let created = 0, linked = 0, skipped = 0;
    const source: VendorSourceInput = { propertyId: propertyId || null, sourceLabel: sourceLabel.trim() || null, originalImportedName: "" };
    // Rows already applied before a failure stay applied — this loop can't
    // roll them back, so on error we stop and report exactly how far it got
    // rather than leaving the button spinning on a silently-hung promise.
    try {
      for (const r of rows) {
        const rowSource = { ...source, originalImportedName: r.originalName };
        if (r.resolution === "skip") { skipped++; continue; }
        if (r.resolution === "link" && r.matchVendorId) { await onLink(r.matchVendorId, rowSource); linked++; continue; }
        await onCreate(r.originalName, rowSource); created++;
      }
    } catch (e) {
      setApplying(false);
      const msg = e instanceof Error ? e.message : "Import failed.";
      setApplyError(`Stopped after ${created} created, ${linked} linked, ${skipped} skipped — "${rows[created + linked + skipped]?.originalName ?? "a row"}" failed: ${msg}`);
      return;
    }
    setApplying(false);
    setResult({ created, linked, skipped });
  }

  const existingVendorName = (id: string) => existingVendors.find((v) => v.id === id)?.name ?? "—";

  return (
    <>
      <div className="panel__scrim" onClick={onClose} />
      <aside className="panel panel--wide" role="dialog" aria-label="Import vendors">
        <div className="panel__head">
          <div><div className="panel__code">Import</div><h2 className="panel__title">Import vendors</h2></div>
          <button className="panel__close" onClick={onClose}>Close</button>
        </div>

        <div className="panel__body">
          {result ? (
            <p className="ven__import-result">
              Imported — {result.created} new vendor{result.created === 1 ? "" : "s"} created,{" "}
              {result.linked} linked to existing vendors, {result.skipped} skipped.
            </p>
          ) : !rows ? (
            <>
              <p className="panel__text">
                Property and a source label are both optional — a spreadsheet can be imported with no property
                context at all. Every vendor starts <strong>Unreviewed</strong>; nothing about the spreadsheet is used
                to guess an onboarding decision.
              </p>
              <div className="panel__grid">
                <label className="panel__field">
                  <span className="panel__label">Property (optional)</span>
                  <select className="panel__input" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                    <option value="">— none —</option>
                    {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="panel__field">
                  <span className="panel__label">Source label (optional)</span>
                  <input className="panel__input" placeholder="e.g. Prior manager handoff sheet" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} />
                </label>
              </div>
              <label className="panel__field">
                <span className="panel__label">Spreadsheet (.csv, .xlsx, or .xls) — a "Vendor Name" column, optionally a "Notes" column</span>
                <input className="panel__input" type="file"
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={onFile} />
              </label>
              {fileError && <p className="panel__error" style={{ whiteSpace: "pre-line" }}>{fileError}</p>}
            </>
          ) : (
            <>
              <p className="panel__text">{rows.length} row{rows.length === 1 ? "" : "s"} found. Review before importing.</p>
              {applyError && <p className="panel__error">{applyError}</p>}
              <div className="ven__import-list">
                {rows.map((r, i) => (
                  <div className="ven__import-row" key={i}>
                    <div className="ven__import-name">
                      {r.originalName}
                      {r.notes && <span className="ven__import-notes"> — {r.notes}</span>}
                    </div>
                    {r.matchVendorId ? (
                      <div className="ven__import-match">
                        Possible match: <strong>{existingVendorName(r.matchVendorId)}</strong>
                        <select className="panel__input" value={r.resolution} onChange={(e) => setResolution(i, e.target.value as ParsedRow["resolution"])}>
                          <option value="link">Link existing</option>
                          <option value="create">Create anyway</option>
                          <option value="skip">Skip</option>
                        </select>
                      </div>
                    ) : (
                      <div className="ven__import-match">
                        <span className="ven__import-new">New vendor</span>
                        <select className="panel__input" value={r.resolution} onChange={(e) => setResolution(i, e.target.value as ParsedRow["resolution"])}>
                          <option value="create">Create</option>
                          <option value="skip">Skip</option>
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="panel__foot">
          {result ? (
            <button className="panel__save" onClick={onDone}>Done</button>
          ) : (
            <>
              <button className="panel__cancel" onClick={onClose}>Cancel</button>
              {rows && <button className="panel__save" disabled={applying} onClick={() => void apply()}>{applying ? "Importing…" : "Confirm import"}</button>}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
