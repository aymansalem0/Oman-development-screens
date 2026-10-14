/**
 * PR #124 + PR #125 integration: authenticated, server-provisioned mapping
 * from the MOEI session identity to a verified ERP inspector ID.
 * Client-supplied actor or supervisor name is never an authorization source.
 */
export function resolveAssignedInspector(actor, assignment, raw=process.env.SI_V2_INSPECTOR_IDENTITY_MAP_JSON||'{}'){
 const email=typeof actor==='string'?actor.trim().toLowerCase():'';
 const id=typeof assignment?.inspectorId==='string'?assignment.inspectorId.trim():'';
 if(!email||!id)return null;
 let mappings;
 try{mappings=JSON.parse(raw);}
 catch{return null;}
 if(!mappings||typeof mappings!=='object'||Array.isArray(mappings))return null;
 const match=Object.entries(mappings).some(([key,value])=>
  key.trim().toLowerCase()===email&&typeof value==='string'&&value===id);
 return match?{id,name:assignment.inspectorName||id}:null;
}
