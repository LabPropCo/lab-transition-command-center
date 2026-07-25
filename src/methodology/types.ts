import type { ScopeType } from "../types";

export interface Template {
  id: string;
  code: string;
  sortOrder: number | null;
  phase: string | null;
  phaseOrder: number | null;
  workstream: string | null;
  subWorkstream: string | null;
  description: string;
  completionStandard: string | null;
  defaultOwner: string | null;
  responsibleParty: string | null;
  priority: string | null;
  goLiveGate: boolean;
  criticalPath: boolean;
  stage: string | null;
  dependsOnCode: string | null;
  scopeType: ScopeType;
  dueOffsetDays: number | null;
  archived: boolean;
  updatedAt: string | null;
}

export interface TemplatePatch {
  code?: string;
  description?: string;
  completion_standard?: string | null;
  workstream?: string | null;
  sub_workstream?: string | null;
  phase?: string | null;
  phase_order?: number | null;
  priority?: string | null;
  default_owner?: string | null;
  responsible_party?: string | null;
  go_live_gate?: boolean;
  critical_path?: boolean;
  stage?: string | null;
  depends_on_code?: string | null;
  scope_type?: ScopeType;
  due_offset_days?: number | null;
  sort_order?: number | null;
  archived?: boolean;
}

export interface MethodologyVersion {
  id: string;
  seq: number;
  label: string;
  note: string | null;
  isCurrent: boolean;
  addedCount: number;
  changedCount: number;
  removedCount: number;
  createdByEmail: string | null;
  createdAt: string;
}

export interface SyncRow {
  code: string;
  propertyId: string | null;
  scopeType: string;
  changeType: "add" | "rename" | "metadata" | "due" | "conflict" | "skip" | "archived";
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  workItemId: string | null;
  completed: boolean;
  templateId: string | null;
}

export interface DiffRow {
  code: string;
  changeType: "added" | "removed" | "changed";
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
}

export interface SyncResult { added: number; renamed: number; updated: number; due: number; }
