# NMC Case Assignment, Ownership & No-Response Escalation — BA-01

**Project:** MOEI Maritime Transformation — NMC / Smart Inspection Business POCs  
**Version:** 0.1, 12 October 2026 — **Business design for review, NOT implemented functionality**  
**GitHub baseline:** `feat/nmc-incident-auto-case-management-20261011` (PR #74, stacked after #69/#70); Smart Inspection complete-cycle PR #61 is a separate draft.  
**Classification:** POC extension requested after NMC AI Specification v3.1 (07 October 2026).

## 1. Requirements and scope boundaries

The ministry's NMC Business POC requests assigned responsibility, coordinated actions, escalation, monitoring, case ownership and audit, including proactive escalation to management. The ministry's Smart Inspection Business POC calls for operational assignment/scheduling, corrective-action follow-up, escalation and case closure. The 07 October NMC **internal AI integration specification v3.1 explicitly excludes SLA management and escalation**. This document therefore introduces a **new, separately identified business-POC extension**; it does not claim existing implementation, that the ministry mandated the sample timers below, or that the internal specification already covers them.

The model MUST preserve all agreed boundaries:

- **Alerts** are notifications with acknowledgement and a link to the case, not an independent regulatory-decision/dispatch screen.
- NMC owns the **Maritime Case** and its officer decisions. Smart Inspection owns **Inspection Case**, field assignment, findings, reports and corrective-action execution.
- A01 recommendations only become executable tasks after **Accept / Modify / Reject by an authorized human officer**. Automatically detected incidents may create a case **with zero tasks** before human approval.
- A02, the deterministic Risk Engine and A01 remain in the agreed reassessment flow; task escalation does **not** change a vessel's stored risk score.
- Escalation must never automatically detain a vessel, restrict port entry, dispatch an inspector, approve an inspection result or close a case.
- The existing ERP-based inspector eligibility/availability and scheduling engine under Smart Inspection retains authority over naming an actual field inspector.
- Technical production-support incident SLAs (P1/P2/P3) are **not** the task-response timers described here.

## 2. Existing POC behavior verified in GitHub

The current `ai-proxy/case-workspace.mjs` task contains `assignedRole`, but there is **no persisted department, organizational job-position assignment, individual claim/acknowledgement time, due-time policy, or automatic no-response escalation scheduler** on this case path. `task(..., 'ESCALATE')` is **manual** and changes both task status to `Escalated` and its assigned role to `NMC_SUPERVISOR`. In the Angular Case Workspace, the field labelled `overdueTasks` currently counts `Escalated` task statuses; this is **not a real deadline calculation**. The current case header displays the generic “NMC Duty Officer” rather than a persisted organizational owner.

Consequently, neither a manual `Escalate` button nor the current `assignedRole` is evidence that timed escalation or complete organizational assignment exists. No production or Oracle migration state is inferred from this source-code review.

## 3. Two levels of responsibility (DO NOT merge)

### 3.1 Case owner

Every active maritime case has **one accountable owning department** and **one responsible job function/position**, e.g.:

- `caseOwnerDepartmentId = NMC_OPERATIONS`
- `caseOwnerPositionCode = NMC_DUTY_OFFICER`
- `caseOwnerUserId = null` until explicitly claimed/assigned in a future user directory.

Opening a case assigns responsibility for monitoring, supervision, coordination, closure readiness and hand-offs; it does not authorize task creation before the human decision. Changes of case owner require a reason, permissions and immutable audit.

### 3.2 Executable task assignment

Each human-approved task is assigned independently to:

`Department → Job Position / Business Function → (optional) specific Employee`

These are **three distinct fields**, never one concatenated “owner”. Assigning a task to a department and function places it in the **eligible work queue**, not with every employee personally. An authorized member may **Claim & Acknowledge** it (atomic, one claimant). A supervisor may instead assign an eligible named employee. One NMC case may have parallel tasks belonging to Compliance, NMC Operations and Smart Inspection coordination.

**Department** is an organizational owner; **Position** is the business function eligible to act; **Permission** is a separate IAM/authorization policy. An HR job title alone does not confer API permission. The current POC uses shared action keys and role labels; therefore real-user identity and precise Keycloak/HR enforcement remain a later integration requirement and must not be presented as already deployed.

## 4. Proposed lifecycle and events

```text
Risk / source incident / acknowledged alert
                ↓
NMC Case opened → accountable NMC department + position set
                ↓
A01 proposed decision → Human Accept / Modify / Reject
                ↓ (approved routes only)
Task created → Department/Position Queue → notification + ACK timer
                ↓
Authorized user CLAIMS & ACKNOWLEDGES → In Progress → Completed
                ↓                          ↘
Required inspection?                        no response / deadline missed
NMC approved referral → SI candidate             ↓
→ preparation → SI coordinator queue         Reminder → Level 1 → Level 2
→ ERP scheduling → named inspector               ↓
→ field execution → results →              Supervisor reassigns / intervenes
NMC A02 + deterministic reassessment
                ↓
NMC supervisor checks all closure conditions → resolve
```

Recommended assignment state is **separate** from task progress:

- `assignmentStatus`: `QUEUED | CLAIMED | ACKNOWLEDGED | REASSIGNED | RELEASED`
- existing `task.status`: `Assigned | In Progress | Completed` (legacy `Escalated` retained for backward compatibility, but not used as the sole source of truth for breach).
- `escalationState`: `NONE | REMINDER_SENT | LEVEL_1 | LEVEL_2 | LEVEL_3 | RESOLVED`.
- `acknowledgedAt`, `startedAt`, `completedAt` are distinct.

A task can be **Escalated and still In Progress**, or escalated and later Completed. Escalation is not the same as reassignment or regulatory severity.

## 5. Automatic no-response escalation policies

Two operational clocks are required:

1. **Acknowledgement / no-response clock:** starts from `assignedAt` when the queue or named recipient is first successfully assigned; stops at real `acknowledgedAt`. This is the core user-requested no-response trigger.
2. **Execution / completion clock:** starts at the configured anchor (`acknowledgedAt` or `assignedAt` by policy); stops on completion/verified outcome. It detects stalled work even when acknowledged.

A third *optional* `START_TIMEOUT` event can flag acknowledged-but-not-started tasks. Rules are determined by `caseType + taskType + priority + department + position + operational calendar`, with explicit policy version.

### Demonstration-only example — not MOEI-approved time limits

For a synthetic critical compliance-verification task assigned **09:00**:

| Time | Condition | Deterministic system action |
|---|---|---|
| 09:00 | Task assigned to Compliance Department / Compliance Officer queue | Persist assignment; notify eligible queue; calculate deadlines |
| 09:10 | No acknowledgement | Reminder to department/position queue |
| 09:15 | Still no acknowledgement | Level 1 escalation to Compliance Supervisor; case owner copied |
| 09:30 | Still no acknowledgement | Level 2 to NMC Duty Manager / designated department manager; allow documented reassignment |
| 10:00 | Still no acknowledgement | Level 3 to configured senior operational management; critical item on escalation dashboard |
| 10:07 | Eligible officer acknowledges | Stop ACK timer, record claimant/time; preserve escalation history |
| Later | Work not complete by completion deadline | Apply **separate completion-overdue policy** without resending ACK-level notifications |

Actual levels, recipients and intervals are **configurable demo parameters** to be validated with MOEI; never hard-code these examples as a ministry policy. The application must show `ackDueAt`, `completionDueAt` and the active policy version.

### Escalation vs reassignment

By default, escalation **notifies and grants visibility** to the next authorized level; it does **not silently transfer ownership**. The supervisor can explicitly `REASSIGN`, `TAKE_OVER` or `RETURN_TO_QUEUE`, each with reason, policy validation, old/new assignee and audit event. No arbitrary “escalate to AI” or auto-enforcement.

### Working calendars and exceptions

The policy selects `24x7` or an approved working-hours/holiday calendar. The NMC may need 24x7 coverage; Smart Inspection office tasks may differ — **no calendar is assumed as a fact without policy approval**.

`WAITING_EXTERNAL` may pause **completion** only if allowed, reason-coded, approved and audited; **ACK timeout never silently pauses**. Clock calculations survive reload/restart and use UTC timestamps + configured time zone/calendar. Completed, resolved or reassigned tasks must not send stale notifications.

A task with no eligible recipient is flagged `NO_ELIGIBLE_ASSIGNEE` and sent to the configured supervising position rather than silently marked acknowledged. Notifications must be idempotent and deduplicated across worker retries.

## 6. Proposed screens

**A. NMC Case Workspace / Ownership card**
- Case owner: department, position, optional officer, assigned-at, status, queue and change-owner action (authorized only).
- Each approved Task card: department / position / actual assignee or Unclaimed / ACK countdown / completion target / escalation level / Claim & Acknowledge / Start / Complete / Escalate / Reassign (authorized only).
- Evidence and human decision/audit remain visible; clearly identify simulated POC information. Original saved risk remains read-only.

**B. My Department Work Queue**
- Filters: Department, Position, Priority, Unclaimed, Awaiting ACK, Due Soon, ACK Overdue, Completion Overdue, Escalated, Case/Inspection ID.
- `Claim & Acknowledge` is an atomic operation; no arbitrary user can claim another department's job without a verified entitlement.
- Refresh gives the latest persisted status; no “frontend-only” due times.

**C. Case & Task Escalation Rules (Settings → NMC Settings; parallel policy in Inspection Settings when required)**
- `Case Type`, `Task Type`, `Priority`, `Owner Department`, `Owner Position`, `Calendar`, `ACK target`, `Reminder target`, `Completion target`, `Escalation stages/recipients`, `Effective From`, `Active`.
- Draft → approval → publish with effective date, versioning and audit, without overwriting active case snapshots or hard-coding policies.

**D. Supervisor Workload & Escalation Dashboard**
- Tasks by department/position/employee; waiting ACK vs waiting completion; first-response rates; actual overdue counts; repeat escalations; blocked hand-offs; unresolved Smart Inspection referrals.
- Drill down to the case/task, decision, evidence, elapsed time and escalation history.

**Critical UI correction:** existing `overdueTasks = count(status === 'Escalated')` must be replaced by real `now > ackDueAt && !acknowledgedAt` and/or `now > completionDueAt && !completedAt`, with a separate “Escalated” KPI.

## 7. Persistence contract (additive; proposed, NOT existing schema)

Recommended logical structures (map to Azure SQL/Flowable for target platform; isolate POC Oracle implementation through repository adapters):

| Entity | Mandatory data |
|---|---|
| `ORG_UNIT` | `id, parentId, nameAr, nameEn, active` |
| `BUSINESS_POSITION` | `code, orgUnitId, nameAr, nameEn, active` |
| `CASE_OWNER_HISTORY` | `caseId, departmentId, positionCode, userId?, validFrom, validTo?, actor, reason` |
| `TASK_ASSIGNMENT` | `id, caseId, taskId, departmentId, positionCode, userId?, assignmentStatus, assignedAt, claimedAt?, acknowledgedAt?, version` |
| `TASK_TIMER_SNAPSHOT` | `assignmentId, policyVersion, calendarCode, ackDueAt, completionDueAt, pausedDuration?, timerStatus` |
| `ESCALATION_POLICY` + `ESCALATION_STAGE` | `scope, selector, effectiveFrom, version, stages, trigger, targetDepartmentId, targetPositionCode, notificationChannel` |
| `ESCALATION_EVENT` | `id, caseId, taskId, assignmentId, policyVersion, stage, trigger, dueAt, firedAt, notifiedAt?, recipients, status, reason, actor` |
| `NOTIFICATION_OUTBOX` | `eventId, deduplicationKey, deliveryChannel, recipientScope, deliveryStatus, attempts, nextRetryAt` |

Use immutable event records and optimistic concurrency, never replace the original saved A01 proposal, human MODIFY reason, case risk score or inspection findings. Each status-changing API checks authorization and `version`. Persisted case state, timer state and outbox must commit atomically or use a transactional-outbox pattern.

## 8. API and backend implementation slice — planned, not yet coded

- `GET /api/ai/nmc/organization/assignable-targets?caseType=...&taskType=...` — department/position eligibility.
- `PATCH /api/ai/nmc/cases/:caseId/owner` — authorized case owner change + reason + version.
- `POST /api/ai/nmc/cases/:caseId/tasks/:taskId/assignment` — department/position assignment or reassign, with eligibility checks.
- `POST /api/ai/nmc/cases/:caseId/tasks/:taskId/claim` — atomic Claim & Acknowledge, identity from authenticated server context, **not** a client-supplied officer name.
- `GET /api/ai/nmc/work-queue` — authorized role/department-filtered queue.
- `GET /api/ai/nmc/escalation-policies`, `POST .../draft`, `POST .../:id/publish` — governed configuration.
- `GET /api/ai/nmc/cases/:caseId/escalation-history` — source-backed timeline.
- Worker: scans durable due timer snapshots; distributed lease/claim + idempotency key `assignmentId:trigger:stage:policyVersion`; rechecks current ACK/completion/assignment before commit and notification; exposes health, retries, audit and restart recovery.

**POC identity caveat:** existing shared editor/publisher keys are only coarse proof-of-concept permissions and cannot prove a particular employee belongs to the selected department/position. Until actual Keycloak and organization memberships exist, run explicit **labelled simulated actors** in a controlled POC test mode, or enforce real identity before live assignment. Do not claim fine-grained production RBAC based on shared keys.

## 9. Smart Inspection integration

NMC `Priority Inspection` acceptance creates a **human-approved referral** only. Assignment at this stage targets the **Inspection Coordination department + Coordinator position**, not an arbitrary field inspector.

Smart Inspection `Inspection Candidate → Preparation → Scheduling` uses existing ERP availability, qualifications, leave/shifts/port constraints and supervisor-confirmed schedule to select a **named inspector**. The field task/inspection case keeps its own lifecycle and audit. NMC sees `PENDING_SCHEDULING → SCHEDULED → COMPLETED` plus linked results; any inspection scheduling delay can follow an Inspection-specific configurable escalation policy without rewriting the NMC case owner or changing the risk score.

For corrective actions, Smart Inspection may assign the follow-up/verification task to a designated compliance/inspection function and track due date, evidence, failed verification and closure; NMC receives the recorded result and only proceeds to separate verified A02 → deterministic Risk Engine → A01 reassessment before closure as required.

## 10. Deterministic acceptance tests (minimum)

| ID | Scenario | Required behavior |
|---|---|---|
| AC-01 | New case before human decision | Case owner exists; no executable tasks yet |
| AC-02 | Human APPROVE creates task | Department + position stored; queue visible to eligible operator |
| AC-03 | Two operators claim same task | Exactly one atomic winner; second receives conflict |
| AC-04 | ACK received before timeout | No automatic `NO_RESPONSE` escalation |
| AC-05 | No ACK past threshold | One stage-1 event + notification with source policy version |
| AC-06 | Worker restarts / processes same due task twice | No duplicate event/notification |
| AC-07 | Supervisor reassigns task | Old owner history preserved; active assignment and timers re-evaluated by versioned policy |
| AC-08 | Task acknowledged, completion overdue | Completion overdue shown; no repeated ACK escalation |
| AC-09 | Waiting for external evidence | Pause only completion timer with approved reason; ACK timer unaltered |
| AC-10 | Referral to Smart Inspection | NMC task owner/coordination role not confused with actual ERP-scheduled inspector |
| AC-11 | Case contains mandatory inspection | NMC closure blocked until approved result + required risk reassessment |
| AC-12 | Priority/rules policy is republished | New rules versioned; existing case timer snapshots not silently retroactively overwritten |
| AC-13 | Task is completed just as worker fires | No stale escalation after persisted completion |
| AC-14 | Unassignable department/position | Safe error, supervisor review path, no fictitious employee or acknowledgement |
| AC-15 | Task escalation | Saved official vessel risk and underlying evidence remain unchanged |

## 11. Phased delivery order and outstanding business choices

**Phase A (next coding slice):** business organization/position catalog, accountable case ownership, approved-task assignment to department+position, Claim & Acknowledge work queue, API authorization guardrails and audit.  
**Phase B:** configurable due-time/escalation rules, resilient automatic worker, notification outbox and escalation trace.  
**Phase C:** Angular Case cards / queue / Settings / supervisor dashboard, inspection handoff, race-condition tests and UAT.

**MOEI/business sign-off needed before fixed production policy:** actual organizational hierarchy; department/position directory; per-priority ACK/response/completion limits; 24x7 vs calendar hours; escalation levels and recipients; who may reassign; approved waiting/pausing reasons; notification channels; named identity/authentication source. Use clearly marked synthetic POC values until resolved.

**Current action:** this document is a reviewed design proposal in its own draft branch; there are **no runtime code, schema, agent, data, scheduler, or deployment changes** in this slice.
