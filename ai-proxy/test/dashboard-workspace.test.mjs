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
