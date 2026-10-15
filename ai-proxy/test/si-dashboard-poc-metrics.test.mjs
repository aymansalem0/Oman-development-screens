import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DashboardWorkspace,SI_DASHBOARD_METRICS}
 from '../dashboard-workspace.mjs';

test('Dashboard Manager accepts and publishes mixed AI + Inspection static POC metrics with standard security rules',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'si-dashboard-metrics-'));
 try{
  const workspace=new DashboardWorkspace({
   mode:'json',file:join(dir,'dashboards.json'),
   editorKey:'editor-key-abcdefghijklmnopqrstuvwxyz',
   publisherKey:'publisher-key-abcdefghijklmnopqrstuvwxyz'
  });
  const board=await workspace.create({
   id:'si-demo-dashboard-test',title:'AI + Inspection POC Dashboard',
   description:'STATIC_POC_SYNTHETIC_NOT_OFFICIAL',
   menuPlacement:'SMART_INSPECTION',filters:{
    risk:'All',type:'All',flag:'All',search:''
   },widgets:[
    {id:'w-ai',type:'kpi',metric:'siAiCoverageRate',title:'AI coverage',span:'half'},
    {id:'w-ops',type:'kpi',metric:'siOpsCapacityFeasible',title:'Inspector match',span:'half'},
    {id:'w-time',type:'bar',metric:'siAiCoverageTrend',title:'AI trend',span:'full',
     chartType:'line',palette:'ocean'},
    {id:'w-work',type:'bar',metric:'siOpsInspectionTrend',title:'Monthly closures',span:'half',
     chartType:'area',palette:'maritime'},
    {id:'w-table',type:'table',metric:'siOpsPlanRegister',title:'Plan samples',span:'full'},
    {id:'w-ai-table',type:'table',metric:'siAiRunRegister',title:'Run samples',span:'full'}
   ]
  });
  assert.equal(board.status,'DRAFT');
  assert.equal(board.widgets.length,6);
  const published=await workspace.publish(board.id,board.version);
  assert.equal(published.status,'PUBLISHED');
  assert.equal(published.menuPlacement,'SMART_INSPECTION');
  assert.equal((await workspace.publishedMenu())[0].id,board.id);
  assert.equal((await workspace.get(board.id)).widgets[2].metric,'siAiCoverageTrend');
  assert.equal(SI_DASHBOARD_METRICS.kpi.length,23);
  assert.equal(SI_DASHBOARD_METRICS.bar.length,11);
  assert.equal(SI_DASHBOARD_METRICS.table.length,2);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('No unlisted metrics, scripts or wrong widget type can be published',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'si-dashboard-deny-'));
 try{
  const workspace=new DashboardWorkspace({mode:'json',file:join(dir,'workspace.json')});
  const base={
   id:'si-unauthorized-metric',title:'POC Dashboard',description:'',
   menuPlacement:'SMART_INSPECTION',
   filters:{risk:'All',type:'All',flag:'All',search:''},
   widgets:[{id:'w1',type:'bar',metric:'siAiCoverageTrend',
    title:'Trend',span:'half'}]
  };
  for(const metric of ['unapprovedSql','siOpsPlanRegister','siAiRuns;DROP']){
   await assert.rejects(()=>workspace.create({
    ...base,widgets:[{...base.widgets[0],metric}]
   }),/DASHBOARD_WIDGET_INVALID/);
  }
  assert.deepEqual(await workspace.list(),[]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
