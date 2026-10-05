// Developer entrypoint for Milestone 1 — proves the full ingestion pipeline
// (discover -> parse -> validate -> normalize -> load) against a real
// Weekly Summary workbook.
//
// IMPORTANT: this always runs against the in-memory MockLabosRepository.
// There is no --supabase flag here on purpose — wiring the real
// SupabaseLabosRepository requires the migrations to actually be applied
// somewhere first (see the Database Verification Checklist in
// docs/RIVER-RUN-MILESTONE-1-BUILD-PLAN.md), which has not happened yet.
// Because the repository is in-memory and process-scoped, state does not
// persist between separate invocations of this script — each run starts
// from a clean slate. That's expected, not a bug: idempotency/overwrite
// behavior is proven in src/labos/syncRun.test.ts within a single process,
// not across CLI invocations.
//
// There is NO default property. --property-name, --reporting-period-end,
// and --workbook-alias are all required — property/period identity must
// always be supplied explicitly (see src/labos/config.ts).
//
// Usage:
//   npm run labos:sync -- --file "C:\path\to\River Run Weekly Summary 2026.07.26.xlsx" \
//     --property-name "River Run" --reporting-period-end 2026-07-26 --workbook-alias riverrun

import { loadLocalFile } from "../../src/labos/sourceFileProviders/localFileProvider";
import { weeklySummaryAdapter } from "../../src/labos/adapters/weeklySummaryAdapter";
import { MockLabosRepository } from "../../src/labos/repository.mock";
import { runSync } from "../../src/labos/syncRun";

const USAGE = 'Usage: npm run labos:sync -- --file "<path>" --property-name "<name>" '
  + "--reporting-period-end <YYYY-MM-DD> --workbook-alias <alias> [--triggered-by <id>] [--confirm-overwrite]";

interface Args {
  file: string;
  propertyName: string;
  reportingPeriodEnd: string;
  workbookPropertyAlias: string;
  triggeredBy: string;
  overwrite: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const file = get("--file");
  const propertyName = get("--property-name");
  const reportingPeriodEnd = get("--reporting-period-end");
  const workbookPropertyAlias = get("--workbook-alias");
  const missing = [
    !file && "--file", !propertyName && "--property-name",
    !reportingPeriodEnd && "--reporting-period-end", !workbookPropertyAlias && "--workbook-alias",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Missing required flag(s): ${missing.join(", ")}\n${USAGE}`);
  }
  return {
    file: file!, propertyName: propertyName!, reportingPeriodEnd: reportingPeriodEnd!,
    workbookPropertyAlias: workbookPropertyAlias!,
    triggeredBy: get("--triggered-by") ?? "developer-cli",
    overwrite: argv.includes("--confirm-overwrite"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = new MockLabosRepository();
  const file = await loadLocalFile(args.file);

  // Property provisioning is a separate, one-time step from ingestion
  // itself — resolved here, never inside runSync (see src/labos/config.ts).
  const propertyId = await repo.getOrCreateProperty(args.propertyName);

  const result = await runSync(repo, {
    adapter: weeklySummaryAdapter,
    file,
    config: {
      propertyId,
      propertyName: args.propertyName,
      reportingPeriodEnd: args.reportingPeriodEnd,
      workbookPropertyAlias: args.workbookPropertyAlias,
    },
    triggeredBy: args.triggeredBy,
    overwriteConfirmedBy: args.overwrite ? args.triggeredBy : undefined,
  });

  console.log(result.summary);
  console.log();
  if (result.validationResults.length > 0) {
    console.log("Validation results:");
    for (const r of result.validationResults) {
      console.log(`  [${r.severity.toUpperCase()}] ${r.ruleCode} — ${r.message}`);
    }
  }
}

main().catch((err) => {
  console.error("Sync Run failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
