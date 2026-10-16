/**
 * PR #124 + PR #125 integration: authenticated, server-provisioned mapping
 * from the MOEI session identity to a verified ERP inspector ID.
 * Client-supplied actor or supervisor name is never an authorization source.
 */
let managedInspectorBinding=()=>null;
/** Configured once at runtime from the persisted ADMIN-managed Google allowlist.
 * The lookup verifies that the ERP identity still exists and remains ACTIVE.
 */
export function setManagedInspectorBindingLookup(fn){
 if(typeof fn!=='function')throw new Error('SI_MANAGED_INSPECTOR_LOOKUP_REQUIRED');
 managedInspectorBinding=fn;
}
export function resolveAssignedInspector(actor, assignment, raw=process.env.SI_V2_INSPECTOR_IDENTITY_MAP_JSON||'{}'){
 const email=typeof actor==='string'?actor.trim().toLowerCase():'';
 const id=typeof assignment?.inspectorId==='string'?assignment.inspectorId.trim():'';
 if(!email||!id)return null;
 const managed=managedInspectorBinding(email);
 if(managed===id)return {id,name:assignment.inspectorName||id};
 let mappings;
 try{mappings=JSON.parse(raw);}
 catch{return null;}
 if(!mappings||typeof mappings!=='object'||Array.isArray(mappings))return null;
 const match=Object.entries(mappings).some(([key,value])=>
  key.trim().toLowerCase()===email&&typeof value==='string'&&value===id);
 return match?{id,name:assignment.inspectorName||id}:null;
}

/**
 * POC identity only. The synthetic engineer ID is derived on the SERVER from
 * the authenticated MOEI session, never accepted from a client form or body.
 * It is not an ERP employee number, qualification or official workforce grant.
 */
import {createHash} from 'node:crypto';
export function pocInspectorIdForActor(actor){
 const value=typeof actor==='string'?actor.trim().toLowerCase():'';
 if(!value||value.length>160)return null;
 return 'POC-MY-'+createHash('sha256').update(value).digest('hex').slice(0,16).toUpperCase();
}
export function matchesAssignedInspector(actor,assignment,mode){
 const official=resolveAssignedInspector(actor,assignment);
 if(official)return official;
 if(mode!=='POC_MOCK'||!assignment?.inspectorId)return null;
 const generated=pocInspectorIdForActor(actor);
 if(!generated||generated!==assignment.inspectorId)return null;
 return {id:generated,name:assignment.inspectorName||'POC My Inspector',
   demoSessionBound:true,officialErpIdentity:false};
}
