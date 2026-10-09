import { Injectable } from '@angular/core';

export type NmcPersistedTaskStatus = 'Pending' | 'Assigned' | 'In Progress' | 'Completed' | 'Escalated';

export interface NmcInspectionOutcome {
  inspectionId: string;
  completedAt: string;
  result: 'Cleared' | 'Completed with Findings' | 'Follow-up Required';
  findingsCount: number;
  criticalFindings: number;
  riskReduction: number;
  summary: string;
  inspector: string;
}

export interface NmcPersistedTimelineEvent {
  id: string;
  time: string;
  type: 'Task' | 'Escalation' | 'Resolution' | 'Inspection';
  title: string;
  detail: string;
  actor: string;
}

interface NmcCasePersistedState {
  taskStates: Record<string, NmcPersistedTaskStatus>;
  inspectionOutcome?: NmcInspectionOutcome;
  timeline: NmcPersistedTimelineEvent[];
}

@Injectable({ providedIn: 'root' })
export class NmcCaseStateService {
  private readonly prefix = 'moei-nmc-case-state:';

  getTaskStates(imo: string): Record<string, NmcPersistedTaskStatus> {
    return { ...this.read(imo).taskStates };
  }

  setTaskStatus(imo: string, taskId: string, status: NmcPersistedTaskStatus): void {
    const state = this.read(imo);
    state.taskStates[taskId] = status;
    this.write(imo, state);
  }

  getInspectionOutcome(imo: string): NmcInspectionOutcome | undefined {
    return this.read(imo).inspectionOutcome;
  }

  setInspectionOutcome(imo: string, outcome: NmcInspectionOutcome): void {
    const state = this.read(imo);
    state.inspectionOutcome = outcome;
    state.taskStates['priority-inspection'] = 'Completed';

    const eventId = `inspection-${outcome.inspectionId}`;
    if (!state.timeline.some(item => item.id === eventId)) {
      state.timeline.unshift({
        id: eventId,
        time: outcome.completedAt,
        type: 'Inspection',
        title: 'Priority inspection completed',
        detail: `${outcome.result} · ${outcome.findingsCount} finding(s) · risk reassessment pending`,
        actor: outcome.inspector
      });
    }

    this.write(imo, state);
  }

  appendTimeline(imo: string, event: NmcPersistedTimelineEvent): void {
    const state = this.read(imo);
    if (!state.timeline.some(item => item.id === event.id)) {
      state.timeline.unshift(event);
      state.timeline = state.timeline.slice(0, 40);
      this.write(imo, state);
    }
  }

  getTimeline(imo: string): NmcPersistedTimelineEvent[] {
    return [...this.read(imo).timeline];
  }

  clear(imo: string): void {
    try {
      sessionStorage.removeItem(this.prefix + imo);
    } catch {
      // no-op in restricted browser contexts
    }
  }

  private read(imo: string): NmcCasePersistedState {
    const empty: NmcCasePersistedState = { taskStates: {}, timeline: [] };

    try {
      const raw = sessionStorage.getItem(this.prefix + imo);
      if (!raw) return empty;

      const parsed = JSON.parse(raw) as Partial<NmcCasePersistedState>;
      return {
        taskStates: parsed.taskStates || {},
        inspectionOutcome: parsed.inspectionOutcome,
        timeline: parsed.timeline || []
      };
    } catch {
      return empty;
    }
  }

  private write(imo: string, state: NmcCasePersistedState): void {
    try {
      sessionStorage.setItem(this.prefix + imo, JSON.stringify(state));
    } catch {
      // no-op in restricted browser contexts
    }
  }
}
