// SUMMARY sheet is a sequence of labeled sections, not a fixed layout: each
// section starts with one of six known labels in column A, is followed by
// its own header row, then data rows until a blank row. Row counts vary
// week to week (this week has zero rows in three sections) — a fixed-offset
// parser would break the moment a heavier week shifts everything down. This
// scanner locates each section by its label, wherever it actually is.

export const SUMMARY_SECTION_LABELS = [
  "NEW RENTALS", "MOVE-INS", "MOVE-OUTS", "NOTICE", "RENEWALS", "CANCELS/DENIAL",
] as const;

export type SummarySectionLabel = (typeof SUMMARY_SECTION_LABELS)[number];

export interface SummarySection {
  label: SummarySectionLabel;
  headerRowIndex: number;    // the row immediately after the label row
  dataRows: string[][];      // rows between the header and the next blank row
}

function isBlankRow(row: string[] | undefined): boolean {
  if (!row) return true;
  return row.every((cell) => cell === "" || cell == null);
}

function firstCell(row: string[] | undefined): string {
  return (row?.[0] ?? "").toString().trim();
}

// `rows` is a sheet already flattened to string[][] via
// XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) — the
// same shape used throughout this reverse-engineering effort.
export function scanSummarySections(rows: string[][]): {
  sections: SummarySection[];
  missingLabels: SummarySectionLabel[];
} {
  const sections: SummarySection[] = [];
  const foundLabels = new Set<SummarySectionLabel>();

  for (let i = 0; i < rows.length; i++) {
    const label = firstCell(rows[i]);
    if (!(SUMMARY_SECTION_LABELS as readonly string[]).includes(label)) continue;

    const sectionLabel = label as SummarySectionLabel;
    foundLabels.add(sectionLabel);
    const headerRowIndex = i + 1;
    const dataRows: string[][] = [];
    let r = headerRowIndex + 1;
    while (r < rows.length && !isBlankRow(rows[r]) && !(SUMMARY_SECTION_LABELS as readonly string[]).includes(firstCell(rows[r]))) {
      dataRows.push(rows[r]);
      r++;
    }
    sections.push({ label: sectionLabel, headerRowIndex, dataRows });
  }

  const missingLabels = SUMMARY_SECTION_LABELS.filter((l) => !foundLabels.has(l));
  return { sections, missingLabels };
}
