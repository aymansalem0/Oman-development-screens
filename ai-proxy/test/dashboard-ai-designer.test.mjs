import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildDashboardAiPrompt,validateDashboardAiDesign,DashboardAiDesignError,NMC_INCIDENT_SOURCE_SCHEMA}
 from '../dashboard-ai-designer.mjs';
const catalog={kpi:['vesselCount'],bar:['byRisk'],table:['vesselTable'],position:[]};
const context={metricCatalog:catalog,placement:'NMC_CENTER'};
test('new unbound metrics retain source/formula but never become executable widgets',()=>{
 const raw={title:'Port Inspector Effectiveness',description:'Monitoring',
  widgets:[{type:'kpi',metric:'vesselCount',title:'Monitored ships',span:'half'},
           {type:'kpi',metric:'inventedLive',title:'False KPI',span:'half'}],
  newMetrics:[{id:'inspectorResponseTime',title:'Average inspection response',
   type:'kpi',sourceKey:'SI_WORK_ORDERS',sourceEntity:'InspectorAssignments',
   fields:['startedAt','assignedAt'],method:'DURATION',
   formula:'Average elapsed hours between assignedAt and startedAt',
   rationale:'Track execution timeliness'}]};
 const result=validateDashboardAiDesign({result:JSON.stringify(raw)},context);
 assert.equal(result.widgets.length,1);
 assert.equal(result.proposedMetrics.length,1);
 assert.equal(result.proposedMetrics[0].status,'SOURCE_MAPPING_REQUIRED');
 assert.equal(result.proposedMetrics[0].executable,false);
 assert.equal(result.dataValuesGenerated,0);
 assert.equal(result.automaticPublication,false);
 assert.deepEqual(result.warnings,['UNKNOWN_OR_UNAVAILABLE_METRIC']);
});
test('model supplied arbitrary source and unsafe field definitions are excluded',()=>{
 const result=validateDashboardAiDesign({title:'Trial',widgets:[],newMetrics:[
  {id:'generatedSQL',title:'Do not execute',type:'kpi',sourceKey:'UNREVIEWED_DB',
   fields:['DROP TABLE FLEET'],method:'QUERY',formula:'DELETE FROM NMC'}
 ]},context);
 assert.equal(result.proposedMetrics.length,0);
 assert.deepEqual(result.warnings,['NEW_METRIC_REQUIRES_BUSINESS_REVIEW']);
});
test('conversational prose never becomes a dashboard or causes fabricated data',()=>{
 assert.throws(()=>validateDashboardAiDesign({result:'Try monitoring your fleet'},context),
   e=>e instanceof DashboardAiDesignError&&e.code==='DASHBOARD_AI_OUTPUT_NOT_STRUCTURED');
});
test('request sends only vetted metric names and review constraints to AI',()=>{
 const request=buildDashboardAiPrompt('Please build a dashboard for maritime operational effectiveness','NMC_CENTER',catalog);
 assert.equal(request.allowedExistingWidgets.kpi[0],'vesselCount');
 assert.match(request.instructions.join(' '),/Never query databases/);
 assert.throws(()=>buildDashboardAiPrompt('short','NMC_CENTER',catalog),/DASHBOARD_AI_PROMPT_INVALID/);
});

test('Dashboard AI knows actual Google Sheets incident columns, not fictitious Oracle tables',()=>{
 const prompt=buildDashboardAiPrompt(
   'Create NMC incident response metrics by type and operational status',
   'NMC_CENTER',catalog,{incidentSourceConfigured:true});
 const source=prompt.verifiedSourceSchemas.find(s=>s.key==='NMC_INCIDENTS_GOOGLE_SHEETS');
 assert.equal(source.transport,'GOOGLE_SHEETS_API');
 assert.equal(source.dataNature,'SYNTHETIC_POC');
 assert.equal(source.sourceConfigured,true);
 assert.equal(source.liveFetchVerified,false);
 assert.ok(source.tables.Incident_Registry.includes('Operational_Status'));
 assert.ok(source.tables.Incident_Registry.includes('Incident_Type'));
 assert.ok(source.tables.AI_Assessments.includes('Officer_Decision'));
 assert.equal(source.incidentRiskIsVesselRisk,false);
 assert.ok(!JSON.stringify(prompt).includes('Incident_Description":"'));
 const cold=buildDashboardAiPrompt(
   'Create NMC incident dashboard proposals without reading source rows',
   'NMC_CENTER',catalog);
 assert.equal(cold.verifiedSourceSchemas[0].sourceConfigured,false);
 assert.equal(cold.verifiedSourceSchemas[0].liveFetchVerified,false);
 assert.equal(NMC_INCIDENT_SOURCE_SCHEMA.tables.Incident_Registry.length,26);
});
test('Incident KPI proposal is retained only with exact Google Sheet fields',()=>{
 const proposal={
  id:'openIncidentCount',title:'Open incidents',type:'kpi',
  sourceKey:'NMC_INCIDENTS_GOOGLE_SHEETS',sourceEntity:'Incident_Registry',
  fields:['Incident_ID','Operational_Status'],method:'COUNT_DISTINCT',
  formula:'Distinct Incident_ID excluding RESOLVED and CLOSED',
  filters:'Operational_Status NOT IN RESOLVED,CLOSED',rationale:'Track open incident cases'};
 const result=validateDashboardAiDesign({
  title:'NMC Incident Situation',widgets:[],newMetrics:[
    proposal,
    {...proposal,id:'fictitious',fields:['incident_status_oracle']},
    {...proposal,id:'fictitiousJoin',sourceEntity:'NON_EXISTENT_TABLE'},
    {...proposal,id:'aiReviewed',sourceEntity:'AI_Assessments',
       fields:['Incident_ID','Assessment_Status'],formula:'Reviewed assessment count'}
  ]},context);
 assert.equal(result.proposedMetrics.length,2);
 assert.equal(result.proposedMetrics[0].sourceKey,'NMC_INCIDENTS_GOOGLE_SHEETS');
 assert.equal(result.proposedMetrics[0].executable,false);
 assert.deepEqual(result.warnings,[
  'NMC_INCIDENT_FIELD_NOT_IN_GOOGLE_SHEET_CONTRACT',
  'NMC_INCIDENT_FIELD_NOT_IN_GOOGLE_SHEET_CONTRACT']);
});

test('AI Dashboard Designer flag is visible in governance and linked from the designer UI',()=>{
 const governance=readFileSync(new URL('../../src/app/pages/nmc-runtime-settings.component.ts',import.meta.url),'utf8');
 const builder=readFileSync(new URL('../../src/app/pages/nmc-dashboard-builder.component.html',import.meta.url),'utf8');
 assert.match(governance,/id:'agent-dashboard-designer'.*keys:\['NMC_DASHBOARD_AI_DESIGN_ENABLED'\]/);
 assert.match(builder,/routerLink="\/moei\/settings\/ai-governance"/);
 assert.match(builder,/useIncidentsPrompt\(\)/);
 assert.match(builder,/refreshAiDesignStatus\(\)/);
});
