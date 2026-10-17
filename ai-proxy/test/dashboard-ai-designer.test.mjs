import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDashboardAiPrompt,validateDashboardAiDesign,DashboardAiDesignError}
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
