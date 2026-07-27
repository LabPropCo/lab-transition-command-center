import { useMemo, useState } from "react";
import type { Vendor } from "../vendors/types";
import type { VendorSourceInput } from "../vendors/api";
import type { Property } from "../types";

// Minimal, dependency-free CSV parser (handles quoted fields with embedded
// commas). Real .xlsx binary parsing would need a new npm dependency (e.g.
// xlsx/papaparse) that isn't in this project yet — not added without
// explicit approval, so for now the import accepts CSV (Excel's own "Save
// As CSV" export covers the common case) rather than the raw .xlsx binary.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); if (row.some((f) => f.trim() !== "")) rows.push(row); }
  return rows;
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
    file.text().then((text) => {
      const table = parseCsv(text);
      if (table.length === 0) { setFileError("That file has no rows."); return; }
      const header = table[0].map((h) => h.trim().toLowerCase());
      const nameIdx = header.findIndex((h) => h === "vendor name" || h === "name" || h === "vendor");
      const notesIdx = header.findIndex((h) => h === "notes" || h === "note");
      if (nameIdx === -1) { setFileError('Could not find a "Vendor Name" column. The first row should have a header, e.g. "Vendor Name".'); return; }
      const parsed: ParsedRow[] = table.slice(1)
        .map((r) => ({ originalName: (r[nameIdx] ?? "").trim(), notes: notesIdx >= 0 ? (r[notesIdx] ?? "").trim() || null : null }))
        .filter((r) => r.originalName)
        .map((r) => {
          const matchVendorId = existingByName.get(normalize(r.originalName)) ?? null;
          return { ...r, matchVendorId, resolution: matchVendorId ? "link" : "create" } as ParsedRow;
        });
      setRows(parsed);
    }).catch(() => setFileError("Could not read that file."));
  }

  function setResolution(i: number, resolution: ParsedRow["resolution"]) {
    setRows((r) => r && r.map((row, idx) => (idx === i ? { ...row, resolution } : row)));
  }

  async function apply() {
    if (!rows) return;
    setApplying(true);
    let created = 0, linked = 0, skipped = 0;
    const source: VendorSourceInput = { propertyId: propertyId || null, sourceLabel: sourceLabel.trim() || null, originalImportedName: "" };
    for (const r of rows) {
      const rowSource = { ...source, originalImportedName: r.originalName };
      if (r.resolution === "skip") { skipped++; continue; }
      if (r.resolution === "link" && r.matchVendorId) { await onLink(r.matchVendorId, rowSource); linked++; continue; }
      await onCreate(r.originalName, rowSource); created++;
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
                <span className="panel__label">CSV file — a "Vendor Name" column, optionally a "Notes" column</span>
                <input className="panel__input" type="file" accept=".csv,text/csv" onChange={onFile} />
              </label>
              {fileError && <p className="panel__error">{fileError}</p>}
            </>
          ) : (
            <>
              <p className="panel__text">{rows.length} row{rows.length === 1 ? "" : "s"} found. Review before importing.</p>
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
