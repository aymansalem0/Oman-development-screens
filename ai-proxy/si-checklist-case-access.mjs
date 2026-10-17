/**
 * MOEI Smart Inspection checklist case authorization.
 *
 * Checklist templates belong to ADMIN configuration. Field case access instead
 * belongs to the inspector assigned on an *approved* scheduling work order.
 * Never trust an inspectorId, orderId or email provided in the request body.
 * Active, linked Google accounts can see only their own case IDs.
 * An unmapped ADMIN retains separate supervisor access for POC review.
 */
import {SiChecklistError} from './si-checklist-library.mjs';
import {pocInspectorIdForActor} from './si-inspector-identity.mjs';

const deny=()=>{throw new SiChecklistError('SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION',403);};

export async function authorizeChecklistCase({identity,caseId,googleUsers,scheduleOrders,mutation=false}={}){
 const email=String(identity?.email||identity?.username||'').trim().toLowerCase();
 if(!email||!caseId)deny();
 const account=googleUsers?.users?.find(u=>u.email===email)||null;
 if(account&&!account.active)deny();
 // A live Google session must remain on the allowlist, including after login.
 if(identity?.provider==='google'&&!account)deny();
 // Use the exact canonical, session-filtered work-order roster used by
 // My Inspection Journey. The synthetic POC identity is server-derived
 // and cannot be claimed through a browser-provided inspector ID.
 const owned=account?.active&&scheduleOrders?.ready?
  await scheduleOrders.mine(email):[];
 const pocId=pocInspectorIdForActor(email);
 const order=owned.find(row=>row.caseId===caseId&&
   (account?.inspectorId&&row.assignment?.inspectorId===account.inspectorId||
     row.mode==='POC_MOCK'&&row.isMyPocEngineer===true&&
     row.assignment?.inspectorId===pocId));
 if(order){
  // Even a Google ADMIN assigned to a POC vessel must start their own
  // work order before entering field results; supervisor review is separate.
  if(mutation&&order.status!=='FIELD_STARTED')
   throw new SiChecklistError('SI_CHECKLIST_FIELD_NOT_STARTED',409);
  return {kind:'ASSIGNED_INSPECTOR',email,
   inspectorId:order.assignment.inspectorId,inspectionStatus:order.status,
   mode:order.mode||'ERP_EXCEL_POC'};
 }
 // Unmapped ADMIN remains a distinct supervisor for formal case review;
 // never use this fallback to impersonate an assigned POC inspector.
 if(identity?.role==='ADMIN'&&!account?.inspectorId)
  return {kind:'SUPERVISOR',email};
 deny();
}
