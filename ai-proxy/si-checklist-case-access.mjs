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

const deny=()=>{throw new SiChecklistError('SI_CHECKLIST_CASE_NOT_ASSIGNED_TO_SESSION',403);};

export async function authorizeChecklistCase({identity,caseId,googleUsers,scheduleOrders,mutation=false}={}){
 const email=String(identity?.email||identity?.username||'').trim().toLowerCase();
 if(!email||!caseId)deny();
 const account=googleUsers?.users?.find(u=>u.email===email)||null;
 if(account&&!account.active)deny();
 // A live Google session must remain on the allowlist, including after login.
 if(identity?.provider==='google'&&!account)deny();
 // Supervisor/template administration is separate from the inspector role.
 // An ADMIN linked to a workforce inspector is treated as that inspector
 // in the field, preventing the ADMIN role from bypassing their assignment.
 if(identity?.role==='ADMIN'&&!account?.inspectorId)
  return {kind:'SUPERVISOR',email};
 if(!account?.active||!account.inspectorId||!scheduleOrders?.ready)deny();
 const owned=await scheduleOrders.mine(email);
 const order=owned.find(row=>row.caseId===caseId&&
    row.assignment?.inspectorId===account.inspectorId);
 if(!order)deny();
 // Inspectors can review their assigned preparation ahead of boarding, but
 // checklist evidence/answers/AI calls require an explicitly started field
 // visit. Supervisor-admin review is handled separately above.
 if(mutation&&order.status!=='FIELD_STARTED')
  throw new SiChecklistError('SI_CHECKLIST_FIELD_NOT_STARTED',409);
 return {kind:'ASSIGNED_INSPECTOR',email,inspectorId:account.inspectorId,
   inspectionStatus:order.status};
}
