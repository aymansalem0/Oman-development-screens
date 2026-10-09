import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DashboardWorkspace } from '../dashboard-workspace.mjs';

const editor='editor-test-key-abcdefghijklmnopqrstuvwxyz';
const publisher='publisher-test-key-abcdefghijklmnopqrstuvwxyz';
function sample(id='dashboard-test'){
  return {
    id,title:'Risk Monitoring',description:'Fleet dashboard',
    status:'DRAFT',version:99,updatedAt:'2000-01-01T00:00:00Z',
    filters:{risk:'All',type:'All',flag:'All',search:''},
    widgets:[{id:'widget-1',type:'kpi',metric:'vesselCount',title:'Vessels',span:'half'}]
  };
}
function setup(){
  const dir=mkdtempSync(join(tmpdir(),'nmc-dashboards-'));
  const opts={mode:'json',file:join(dir,'workspace.json'),editorKey:editor,publisherKey:publisher};
  return {workspace:new DashboardWorkspace(opts),opts,close:()=>rmSync(dir,{recursive:true,force:true})};
}
test('editor and publisher roles require different configured keys',()=>{
  const {workspace,close}=setup();
  try{
    assert.doesNotThrow(()=>workspace.assertRole({headers:{'x-nmc-dashboard-key':editor}},'EDITOR'));
    assert.throws(()=>workspace.assertRole({headers:{'x-nmc-dashboard-key':editor}},'PUBLISHER'),/DASHBOARD_ACCESS_DENIED/);
    assert.doesNotThrow(()=>workspace.assertRole({headers:{'x-nmc-dashboard-key':publisher}},'PUBLISHER'));
    assert.throws(()=>workspace.assertRole({headers:{'x-nmc-dashboard-key':'wrong'}},'EDITOR'),/DASHBOARD_ACCESS_DENIED/);
  }finally{close();}
});
test('create, update, optimistic conflict, publication and revision audit',async()=>{
  const {workspace,close}=setup();
  try{
    const created=await workspace.create(sample());
    assert.equal(created.version,1);
    assert.equal(created.status,'DRAFT');
    assert.equal(created.title,'Risk Monitoring');
    const updated=await workspace.save(created.id,{...created,title:'Risk Overview'});
    assert.equal(updated.version,2);
    await assert.rejects(()=>workspace.save(created.id,{...created,title:'Stale Save'}),/DASHBOARD_VERSION_CONFLICT/);
    const published=await workspace.publish(created.id,2);
    assert.equal(published.version,3);
    assert.equal(published.status,'PUBLISHED');
    await assert.rejects(()=>workspace.save(created.id,{...published,title:'Illegal'}),/PUBLISHED_DASHBOARD_LOCKED/);
    await assert.rejects(()=>workspace.archive(created.id,3),/PUBLISHED_DASHBOARD_LOCKED/);
    const revisions=await workspace.revisions(created.id);
    assert.deepEqual(revisions.map(x=>x.action),['PUBLISHED','UPDATED','CREATED']);
    assert.equal((await workspace.list()).length,1);
  }finally{close();}
});
test('invalid widget definitions are rejected and do not change storage',async()=>{
  const {workspace,close}=setup();
  try{
    const invalid=sample();
    invalid.widgets[0].metric='arbitraryQuery';
    await assert.rejects(()=>workspace.create(invalid),/DASHBOARD_WIDGET_INVALID/);
    assert.equal((await workspace.list()).length,0);
  }finally{close();}
});
test('archiving a draft preserves history and survives service re-instantiation',async()=>{
  const {workspace,opts,close}=setup();
  try{
    const created=await workspace.create(sample('dashboard-other'));
    await workspace.archive(created.id,1);
    assert.equal(await workspace.get(created.id),null);
    assert.equal((await workspace.list()).length,0);
    const reopened=new DashboardWorkspace(opts);
    assert.equal((await reopened.list()).length,0);
    assert.equal((await reopened.revisions(created.id))[0].action,'ARCHIVED');
  }finally{close();}
});
test('write operations stay disabled with no configured credentials',()=>{
  const store=new DashboardWorkspace({mode:'json',editorKey:'',publisherKey:''});
  assert.throws(()=>store.assertRole({headers:{'x-nmc-dashboard-key':'anything'}},'EDITOR'),/DASHBOARD_WRITE_NOT_CONFIGURED/);
});


test('published sidebar registry excludes drafts and groups all allowed menu areas',async()=>{
  const {workspace,opts,close}=setup();
  try{
    const nmc=await workspace.create({...sample('nmc-test'),menuPlacement:'NMC_CENTER'});
    const smart=await workspace.create({...sample('smart-test'),menuPlacement:'SMART_INSPECTION'});
    const settings=await workspace.create({...sample('settings-test'),menuPlacement:'SETTINGS'});
    await workspace.create({...sample('draft-test'),menuPlacement:'SMART_INSPECTION'});
    assert.deepEqual(await workspace.publishedMenu(),[]);
    await workspace.publish(nmc.id,nmc.version);
    await workspace.publish(smart.id,smart.version);
    await workspace.publish(settings.id,settings.version);
    const items=await workspace.publishedMenu();
    assert.equal(items.length,3);
    assert.deepEqual(
      new Set(items.map(item=>item.menuPlacement)),
      new Set(['NMC_CENTER','SMART_INSPECTION','SETTINGS'])
    );
    assert.equal(items.some(item=>item.id==='draft-test'),false);
    assert.equal(Object.keys(items[0]).sort().join(','),'id,menuPlacement,title');
    const reopened=new DashboardWorkspace(opts);
    assert.deepEqual(await reopened.publishedMenu(),items);
  }finally{close();}
});

test('legacy dashboards without menu placement default to NMC Center',async()=>{
  const {workspace,close}=setup();
  try{
    const created=await workspace.create(sample('legacy-test'));
    assert.equal(created.menuPlacement,'NMC_CENTER');
    const published=await workspace.publish(created.id,created.version);
    assert.equal(published.menuPlacement,'NMC_CENTER');
    assert.equal((await workspace.publishedMenu())[0].menuPlacement,'NMC_CENTER');
  }finally{close();}
});

test('invalid menu target is rejected before any shared-dashboard change',async()=>{
  const {workspace,close}=setup();
  try{
    await assert.rejects(()=>workspace.create({
      ...sample('invalid-target'),menuPlacement:'CUSTOM_SCRIPT'
    }),/DASHBOARD_MENU_PLACEMENT_INVALID/);
    assert.deepEqual(await workspace.list(),[]);
  }finally{close();}
});

test('menu location survives draft changes and publication',async()=>{
  const {workspace,close}=setup();
  try{
    const created=await workspace.create({...sample('placed'),menuPlacement:'NMC_CENTER'});
    const changed=await workspace.save(created.id,{
      ...created,menuPlacement:'SETTINGS'
    });
    await workspace.publish(created.id,changed.version);
    assert.equal((await workspace.publishedMenu())[0].menuPlacement,'SETTINGS');
  }finally{close();}
});


test('publisher can relocate a published dashboard without changing its widgets',async()=>{
  const {workspace,close}=setup();
  try{
    const d=await workspace.create({...sample('reposition-test'),menuPlacement:'NMC_CENTER'});
    const published=await workspace.publish(d.id,d.version);
    const moved=await workspace.movePublished(published.id,'SMART_INSPECTION',published.version);
    assert.equal(moved.version,published.version+1);
    assert.equal(moved.status,'PUBLISHED');
    assert.deepEqual(moved.widgets,published.widgets);
    assert.deepEqual((await workspace.publishedMenu()).map(x=>x.menuPlacement),['SMART_INSPECTION']);
    await assert.rejects(()=>workspace.movePublished(published.id,'SETTINGS',published.version),
      /DASHBOARD_VERSION_CONFLICT/);
    const revisions=await workspace.revisions(d.id);
    assert.deepEqual(revisions.map(r=>r.action),['UPDATED','PUBLISHED','CREATED']);
  }finally{close();}
});

test('published relocation rejects draft or unsupported menu area',async()=>{
  const {workspace,close}=setup();
  try{
    const draft=await workspace.create(sample('only-draft'));
    await assert.rejects(()=>workspace.movePublished(draft.id,'SETTINGS',draft.version),
      /DASHBOARD_NOT_PUBLISHED/);
    await assert.rejects(()=>workspace.movePublished(draft.id,'UNAUTHORIZED_MENU',draft.version),
      /DASHBOARD_MENU_PLACEMENT_INVALID/);
  }finally{close();}
});


test('chart type and colors persist across central save, publish and reload',async()=>{
  const {workspace,opts,close}=setup();
  try{
    const doc=sample('multi-chart-test');
    doc.widgets.push({
      id:'chart-1',type:'bar',metric:'byRisk',title:'Fleet Risk',
      span:'half',chartType:'donut',palette:'maritime'
    });
    doc.widgets.push({
      id:'chart-2',type:'bar',metric:'byType',title:'Fleet Types',
      span:'full',chartType:'column',palette:'vibrant'
    });
    const created=await workspace.create(doc);
    assert.equal(created.widgets[1].chartType,'donut');
    assert.equal(created.widgets[2].palette,'vibrant');
    const revised=await workspace.save(created.id,{
      ...created,widgets:created.widgets.map(w=>
        w.id==='chart-2'?{...w,chartType:'area',palette:'sunset'}:w)
    });
    const published=await workspace.publish(revised.id,revised.version);
    assert.equal(published.widgets[2].chartType,'area');
    assert.equal(published.widgets[2].palette,'sunset');
    const fresh=new DashboardWorkspace(opts);
    const stored=await fresh.get(published.id);
    assert.deepEqual(stored.widgets,published.widgets);
  }finally{close();}
});

test('previously saved bar widgets automatically use horizontal bar and maritime palette',async()=>{
  const {workspace,close}=setup();
  try{
    const doc=sample('legacy-chart');
    doc.widgets.push({id:'old-bar',type:'bar',metric:'byFlag',title:'Flags',span:'full'});
    const created=await workspace.create(doc);
    assert.equal(created.widgets[1].chartType,'horizontalBar');
    assert.equal(created.widgets[1].palette,'maritime');
  }finally{close();}
});

test('disallowed chart types and palettes cannot enter centralized dashboard storage',async()=>{
  const {workspace,close}=setup();
  try{
    const doc=sample('invalid-chart');
    doc.widgets.push({id:'bad',type:'bar',metric:'byType',title:'Types',span:'full',
      chartType:'scriptTag',palette:'vibrant'});
    await assert.rejects(()=>workspace.create(doc),/DASHBOARD_CHART_TYPE_INVALID/);
    doc.widgets[1].chartType='column';
    doc.widgets[1].palette='malicious-color';
    await assert.rejects(()=>workspace.create(doc),/DASHBOARD_CHART_PALETTE_INVALID/);
    assert.equal((await workspace.list()).length,0);
  }finally{close();}
});


test('edit published then republish same ID, keeping current page live until approval',async()=>{
  const {workspace,opts,close}=setup();
  try{
    const first=await workspace.create({...sample('published-test'),menuPlacement:'NMC_CENTER'});
    const published=await workspace.publish(first.id,first.version);
    const working=await workspace.startPublishedEdit(published.id);
    assert.notEqual(working.id,published.id);
    assert.equal(working.publishedParentId,published.id);
    assert.equal(working.basePublishedVersion,published.version);
    assert.equal((await workspace.get(published.id)).status,'PUBLISHED');
    assert.equal((await workspace.publishedMenu()).length,1);
    const revised=await workspace.save(working.id,{
      ...working,title:'Updated Maritime Risk',menuPlacement:'SMART_INSPECTION',
      widgets:[{id:'chart-marine',type:'bar',metric:'byRisk',
        title:'New Risk Chart',span:'full',chartType:'donut',palette:'maritime'}]
    });
    assert.equal(revised.publishedParentId,published.id);
    assert.equal((await workspace.get(published.id)).title,'Risk Monitoring');
    assert.equal((await workspace.publishedMenu())[0].menuPlacement,'NMC_CENTER');
    const republished=await workspace.publish(revised.id,revised.version);
    assert.equal(republished.id,published.id);
    assert.equal(republished.status,'PUBLISHED');
    assert.equal(republished.version,published.version+1);
    assert.equal(republished.title,'Updated Maritime Risk');
    assert.equal(republished.menuPlacement,'SMART_INSPECTION');
    assert.equal(republished.widgets[0].chartType,'donut');
    assert.equal((await workspace.publishedMenu()).length,1);
    assert.equal((await workspace.publishedMenu())[0].id,published.id);
    assert.equal((await workspace.get(revised.id)),null);
    const loaded=new DashboardWorkspace(opts);
    assert.deepEqual(await loaded.get(published.id),republished);
    assert.deepEqual((await loaded.revisions(published.id)).map(x=>x.action),
      ['PUBLISHED','PUBLISHED','CREATED']);
    assert.equal((await loaded.revisions(revised.id))[0].action,'ARCHIVED');
  }finally{close();}
});

test('stale edit does not overwrite newer published version',async()=>{
  const {workspace,close}=setup();
  try{
    const first=await workspace.create(sample('conflict-test'));
    const published=await workspace.publish(first.id,first.version);
    const editor=await workspace.startPublishedEdit(published.id);
    const updated=await workspace.save(editor.id,{...editor,title:'Revised title'});
    // A manager relocates the live dashboard while the linked draft is open.
    const moved=await workspace.movePublished(published.id,'SETTINGS',published.version);
    await assert.rejects(()=>workspace.publish(updated.id,updated.version),
      /DASHBOARD_PUBLISHED_VERSION_CONFLICT/);
    assert.equal((await workspace.get(editor.id)).status,'DRAFT');
    const unchangedLive=await workspace.get(published.id);
    assert.equal(unchangedLive.version,published.version+1);
    assert.equal(unchangedLive.title,published.title);
    assert.equal(unchangedLive.menuPlacement,'SETTINGS');
    assert.equal(moved.id,published.id);
  }finally{close();}
});

test('tampering with revision parent in save body is ignored',async()=>{
  const {workspace,close}=setup();
  try{
    const first=await workspace.create(sample('tamper-parent'));
    const pub=await workspace.publish(first.id,first.version);
    const editing=await workspace.startPublishedEdit(pub.id);
    const updated=await workspace.save(editing.id,{
      ...editing,publishedParentId:'another-dashboard',
      basePublishedVersion:999
    });
    assert.equal(updated.publishedParentId,pub.id);
    assert.equal(updated.basePublishedVersion,pub.version);
    assert.equal((await workspace.get(pub.id)).status,'PUBLISHED');
  }finally{close();}
});


test('editing a published dashboard twice resumes the same central revision instead of duplicating it',async()=>{
  const {workspace,close}=setup();
  try{
    const created=await workspace.create(sample('original-once'));
    const published=await workspace.publish(created.id,created.version);
    const draftA=await workspace.startPublishedEdit(published.id);
    const draftB=await workspace.startPublishedEdit(published.id);
    assert.equal(draftA.id,draftB.id);
    assert.equal((await workspace.list()).length,2); // one live + one working revision
    const changed=await workspace.save(draftA.id,{...draftA,title:'Revised Risk View'});
    const resumed=await workspace.startPublishedEdit(published.id);
    assert.equal(resumed.id,draftA.id);
    assert.equal(resumed.title,changed.title);
    assert.equal(resumed.version,changed.version);
    assert.equal((await workspace.publishedMenu()).length,1);
  }finally{close();}
});

test('republish rejects an unsaved revision and does not increment live version',async()=>{
  const {workspace,close}=setup();
  try{
    const original=await workspace.create(sample('unsaved-revision'));
    const live=await workspace.publish(original.id,original.version);
    const draft=await workspace.startPublishedEdit(live.id);
    await assert.rejects(()=>workspace.publish(draft.id,draft.version),
      /DASHBOARD_REVISION_NOT_SAVED/);
    const unchanged=await workspace.get(live.id);
    assert.equal(unchanged.version,live.version);
    assert.deepEqual(unchanged.widgets,live.widgets);
    assert.equal((await workspace.get(draft.id)).status,'DRAFT');
  }finally{close();}
});

test('saving an unchanged revision cannot produce fake republished versions',async()=>{
  const {workspace,close}=setup();
  try{
    const original=await workspace.create(sample('unchanged-content'));
    const live=await workspace.publish(original.id,original.version);
    const draft=await workspace.startPublishedEdit(live.id);
    const saved=await workspace.save(draft.id,draft);
    await assert.rejects(()=>workspace.publish(saved.id,saved.version),
      /DASHBOARD_REVISION_UNCHANGED/);
    const remaining=await workspace.get(live.id);
    assert.equal(remaining.version,live.version);
    assert.deepEqual(remaining.widgets,live.widgets);
    assert.equal((await workspace.revisions(live.id)).length,2);
  }finally{close();}
});

test('republish updates exact existing published content and original URL after central save',async()=>{
  const {workspace,opts,close}=setup();
  try{
    const original=await workspace.create({
      ...sample('preserved-url'),
      widgets:[{id:'w-one',type:'bar',metric:'byRisk',title:'Fleet Risk',
        span:'full',chartType:'horizontalBar',palette:'maritime'}]
    });
    const live=await workspace.publish(original.id,original.version);
    const draft=await workspace.startPublishedEdit(live.id);
    const newDesign=await workspace.save(draft.id,{
      ...draft,title:'Maritime Risk Monitoring Updated',
      widgets:[{...draft.widgets[0],title:'New Critical Risk Doughnut',
        chartType:'donut',palette:'vibrant'}]
    });
    const prior=await workspace.get(original.id);
    assert.equal(prior.title,live.title);
    assert.equal(prior.widgets[0].chartType,'horizontalBar');
    const next=await workspace.publish(newDesign.id,newDesign.version);
    const anotherBrowserStore=new DashboardWorkspace(opts);
    const viewed=await anotherBrowserStore.get(original.id);
    assert.equal(next.id,original.id);
    assert.equal(viewed.id,original.id);
    assert.equal(viewed.title,'Maritime Risk Monitoring Updated');
    assert.equal(viewed.widgets[0].title,'New Critical Risk Doughnut');
    assert.equal(viewed.widgets[0].chartType,'donut');
    assert.equal(viewed.widgets[0].palette,'vibrant');
    assert.equal(viewed.version,live.version+1);
    assert.equal((await anotherBrowserStore.publishedMenu())[0].id,original.id);
    assert.equal((await anotherBrowserStore.revisions(original.id))[0].action,'PUBLISHED');
  }finally{close();}
});
