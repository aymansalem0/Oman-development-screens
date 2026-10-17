/** Airia dashboard design proposals. Never execute AI-generated SQL or fabricate metrics. */
export class DashboardAiDesignError extends Error{constructor(code,status=422){super(code);this.code=code;this.status=status;}}
export const DESIGN_SOURCES=Object.freeze([
 {key:'NMC_FLEET',label:'NMC vessel and risk assessments'},
 {key:'NMC_INCIDENTS_GOOGLE_SHEETS',label:'NMC Incident Registry in Google Sheets, SYNTHETIC_POC source data and separately reviewed AI assessments'},
 {key:'SI_WORK_ORDERS',label:'Smart Inspection plans and work orders'},
 {key:'SI_FIELD_FINDINGS',label:'Inspector-confirmed findings and CAPA'},
 {key:'SDB_READINESS',label:'Seafarer readiness sandbox or approved real service'},
 {key:'SHIPS_REGISTRY',label:'Ships registry integration'},
 {key:'PORTS_FACILITIES',label:'Ports and marine facilities'},
 {key:'COMPANIES',label:'Maritime companies'},
 {key:'LEGISLATION',label:'Maritime legislation'},
 {key:'EXTERNAL',label:'External approved source'}
]);
/** Read-only schema contract, NOT Google Sheet rows or a claim of live availability.
 * Incident_Registry is the POC source of operational incident status.
 * AI_Assessments contains separately produced assessments, not verified facts.
 */
export const NMC_INCIDENT_SOURCE_SCHEMA=Object.freeze({
  key:'NMC_INCIDENTS_GOOGLE_SHEETS',
  transport:'GOOGLE_SHEETS_API',
  dataNature:'SYNTHETIC_POC',
  dashboardReadEndpoint:'/api/ai/nmc/incidents',
  incidentRiskIsVesselRisk:false,
  tables:{
    Incident_Registry:[
      'Incident_ID','Source_Type','Source_Organization','Source_Reference',
      'Reported_At_UTC','Occurred_At_UTC','IMO','Vessel_Name','Incident_Type',
      'Port_or_Zone','Latitude','Longitude','Incident_Description',
      'Source_Incident_Status','Operational_Status','Reported_Severity',
      'Persons_Affected','Pollution_Reported','Evidence_Reference','Source_URL',
      'Received_At_UTC','Updated_At_UTC','Assigned_Officer','Officer_Notes',
      'Data_Nature','AI_Review_Request'
    ],
    AI_Assessments:[
      'Incident_ID','Description_SHA256','Assessment_ID','Assessed_At_UTC',
      'AI_Provider','AI_Model','AI_Incident_Category','Policy_Impact_0_5',
      'Policy_Urgency_0_5','Policy_Exposure_0_5','Policy_Recurrence_0_5',
      'Incident_Risk_Score_0_100','Incident_Risk_Band','AI_Proposed_Followup',
      'AI_Reasoning','AI_Confidence_0_1','Missing_Information',
      'Officer_Decision','Officer_Name','Officer_Reviewed_At_UTC',
      'Approved_Followup_Status','Linked_Case_ID','Assessment_Status',
      'Governance_Notice','AI_Suggested_Followup_State',
      'Officer_Approved_Followup_State','Officer_Review_Reason',
      'A01_Incident_Evidence_IDs','A02_Incident_Compliance_Status',
      'A02_Incident_Evidence_IDs','A02_Incident_Reasoning',
      'Incident_Agent_Contract_Version'
    ]
  },
  restrictions:[
    'Google Sheets is the source of POC incidents, not Oracle fleet risk',
    'Read no sheet row values for AI Dashboard generation',
    'Officer-reviewed assessment is distinct from unreviewed AI advice',
    'The displayed incident cohort can be filtered by NMC case-linking policies',
    'Metrics require implemented and approved source mapping before they are executable'
  ]
});
const SOURCES=new Set(DESIGN_SOURCES.map(x=>x.key));
const METHODS=new Set(['COUNT','COUNT_DISTINCT','SUM','AVERAGE','RATIO','DURATION','GROUP_COUNT','LATEST']);
const CHARTS=new Set(['horizontalBar','column','pie','donut','line','area']);
const PALETTES=new Set(['maritime','vibrant','ocean','sunset']);
const PLACEMENTS=new Set(['NMC_CENTER','SMART_INSPECTION','SETTINGS']);
const take=(x,n=240)=>typeof x==='string'?x.trim().slice(0,n):'';
function reject(code='DASHBOARD_AI_OUTPUT_INVALID'){throw new DashboardAiDesignError(code,502);}
function unwrap(raw){
 let value=raw;
 for(let i=0;i<8;i++){
  if(typeof value==='string'){
   const text=value.trim();
   if(text.length>65000)reject('DASHBOARD_AI_RESPONSE_TOO_LARGE');
   try{value=JSON.parse(text);}catch{reject('DASHBOARD_AI_OUTPUT_NOT_STRUCTURED');}
   continue;
  }
  if(!value||typeof value!=='object'||Array.isArray(value))break;
  if(Array.isArray(value.widgets)&&Array.isArray(value.newMetrics))return value;
  const key=['result','response','output','data','finalOutput','outputText','content','value'].find(k=>value[k]!==undefined);
  if(!key)break;value=value[key];
 }
 reject('DASHBOARD_AI_OUTPUT_NOT_STRUCTURED');
}
export function buildDashboardAiPrompt(prompt,placement,metricCatalog,{incidentSourceConfigured=false}={}){
 const question=take(prompt,2000);
 if(question.length<15||!PLACEMENTS.has(placement))throw new DashboardAiDesignError('DASHBOARD_AI_PROMPT_INVALID',422);
 return {task:'MOEI_AI_DASHBOARD_DESIGN_V1',domain:placement,question,
  allowedExistingWidgets:metricCatalog,suggestedDataSourceTypes:DESIGN_SOURCES,
  verifiedSourceSchemas:[{...NMC_INCIDENT_SOURCE_SCHEMA,
    sourceConfigured:incidentSourceConfigured,liveFetchVerified:false}],
  expectedOutput:{title:'dashboard title',description:'business purpose',
   widgets:[{type:'kpi|bar|table|position',metric:'exact existing metric ID',title:'title',span:'half|full'}],
   newMetrics:[{id:'proposedId',title:'title',type:'kpi|bar|table|position',
    sourceKey:'one suggestedDataSourceTypes key',sourceEntity:'suggested dataset',
    fields:['source fields'],method:'COUNT|COUNT_DISTINCT|SUM|AVERAGE|RATIO|DURATION|GROUP_COUNT|LATEST',
    formula:'human-readable calculation, numerator and denominator if applicable',
    grouping:'optional dimension',filters:'optional conditions',rationale:'why this metric helps'}]},
  instructions:[
   'Return ONE structured JSON object; no markdown or prose.',
   'Use only exact permitted metrics in widgets; never invent a live metric ID.',
   'Suggest new metrics separately in newMetrics, with datasource and calculation metadata.',
   'No SQL, Javascript, code, invented live numbers or unsupported datasource claims.',
   'All new fields, datasets and formulas are UNVERIFIED until a business owner maps and approves them.',
   'For NMC incident KPIs, use NMC_INCIDENTS_GOOGLE_SHEETS and EXACT column names from Incident_Registry or AI_Assessments. Do not invent Oracle incident tables.',
   'A configured Google Sheet source is not proof of successful row retrieval. Distinguish synthetic POC incidents from official cases and vessel risk.',
   'Only propose incidents as newMetrics until live aggregation/reporting is implemented; no invented chart data.',
   'Never query databases, bind a source, publish a dashboard or alter statutory decisions.'
  ]};
}
export function validateDashboardAiDesign(raw,{metricCatalog,placement}){
 const data=unwrap(raw);
 if(!Array.isArray(data.widgets)||!Array.isArray(data.newMetrics)||
  data.widgets.length>30||data.newMetrics.length>20)reject();
 const widgets=[],warnings=[];
 for(const w of data.widgets){
  if(!w||typeof w!=='object'||Array.isArray(w)||!Array.isArray(metricCatalog[w.type])||
   !metricCatalog[w.type].includes(w.metric)||!['half','full'].includes(w.span)){
   warnings.push('UNKNOWN_OR_UNAVAILABLE_METRIC');continue;}
  if(w.type==='bar'&&((w.chartType!==undefined&&!CHARTS.has(w.chartType))||
   (w.palette!==undefined&&!PALETTES.has(w.palette)))){warnings.push('INVALID_CHART_TYPE');continue;}
  widgets.push({type:w.type,metric:w.metric,title:take(w.title,100)||w.metric,span:w.span,
   ...(w.type==='bar'?{chartType:w.chartType||'horizontalBar',palette:w.palette||'maritime'}:{})});
 }
 const proposedMetrics=[],ids=new Set();
 for(const m of data.newMetrics){
  if(!m||typeof m!=='object'||Array.isArray(m)){warnings.push('INVALID_PROPOSED_METRIC');continue;}
  const id=take(m.id,64),fields=m.fields;
  if(!/^[A-Za-z][A-Za-z0-9_-]{2,63}$/.test(id)||ids.has(id)||
   !['kpi','bar','table','position'].includes(m.type)||!SOURCES.has(m.sourceKey)||
   !METHODS.has(m.method)||!take(m.title,100)||!take(m.formula,300)||
   !Array.isArray(fields)||fields.length>15||
   fields.some(f=>typeof f!=='string'||!/^([a-zA-Z][a-zA-Z0-9_.]{0,79})$/.test(f))){
   warnings.push('NEW_METRIC_REQUIRES_BUSINESS_REVIEW');continue;}
  if(m.sourceKey==='NMC_INCIDENTS_GOOGLE_SHEETS'){
    const allowed=NMC_INCIDENT_SOURCE_SCHEMA.tables[m.sourceEntity];
    if(!Array.isArray(allowed)||fields.some(f=>!allowed.includes(f))){
      warnings.push('NMC_INCIDENT_FIELD_NOT_IN_GOOGLE_SHEET_CONTRACT');continue;
    }
  }
  ids.add(id);proposedMetrics.push({id,title:take(m.title,100),type:m.type,
   sourceKey:m.sourceKey,sourceEntity:take(m.sourceEntity,100),
   fields,method:m.method,formula:take(m.formula,300),
   grouping:take(m.grouping,100),filters:take(m.filters,200),rationale:take(m.rationale,450),
   status:'SOURCE_MAPPING_REQUIRED',dataNature:'UNVERIFIED_PROPOSAL',executable:false});
 }
 return {status:'AI_DASHBOARD_PROPOSAL_REVIEW_REQUIRED',provider:'AIRIA_NMC_DESK',
  title:take(data.title,100)||'AI Dashboard Draft',description:take(data.description,500),
  placement,widgets,proposedMetrics,warnings,
  metricsCreated:0,sourceConnectionsCreated:0,dataValuesGenerated:0,draftOnly:true,automaticPublication:false};
}
