import type { ScopeType } from "../types";

export interface WorkItem {
  id: string;
  transitionId: string;
  propertyId: string | null;   // null = transition-level (shared)
  scopeType: ScopeType;
  code: string;
  sortOrder: number | null;
  phase: string | null;
  phaseOrder: number | null;
  workstream: string | null;
  subWorkstream: string | null;
  description: string;
  completionStandard: string | null;
  owner: string | null;
  responsibleParty: string | null;
  priority: string | null;
  goLiveGate: boolean;
  criticalPath: boolean;
  stage: string | null;
  gateGroup: string | null;
  dependsOnCode: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  notes: string | null;
  dropboxLink: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface WorkItemPatch {
  status?: string;
  owner?: string | null;
  responsible_party?: string | null;
  due_date?: string | null;
  due_date_source?: string;
  notes?: string | null;
  dropbox_link?: string | null;
}
