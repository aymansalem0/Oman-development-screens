import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync('src/app/pages/si-candidate-workbench.component.html','utf8');
const ts=readFileSync('src/app/pages/si-candidate-workbench.component.ts','utf8');
const css=readFileSync('src/app/pages/si-candidate-workbench.component.css','utf8');

test('SI-C01 access controls appear alongside the agent, before preview/run',()=>{
 const c01=html.indexOf('class="si-panel si-c01-panel"');
 const strip=html.indexOf('class="si-access-strip"');
 const editor=html.indexOf('id="si-operator-editor"');
 const reviewer=html.indexOf('id="si-operator-reviewer"');
 const publisher=html.indexOf('id="si-operator-publisher"');
 const preview=html.indexOf('(click)="previewCandidateAi()"');
 const p01=html.indexOf('class="si-panel ai-ranking-panel"');
 assert.ok(c01>=0&&c01<strip&&strip<reviewer&&reviewer<editor&&editor<publisher&&publisher<preview&&preview<p01,
   'All operator fields should be visible directly inside C01, before action buttons');
 assert.equal(html.split('[(ngModel)]="editorKey"').length-1,1);
 assert.equal(html.split('[(ngModel)]="publisherKey"').length-1,1);
 assert.equal(html.split('[(ngModel)]="reviewer"').length-1,1);
 assert.doesNotMatch(html,/03 · Operator & Access/);
});
test('secrets remain masked and unpersisted in browser; backend role gate stays authoritative',()=>{
 assert.match(html,/id="si-operator-editor" type="password"/);
 assert.match(html,/id="si-operator-publisher" type="password"/);
 assert.match(html,/#editorAccessKey id="si-operator-editor"/);
 assert.match(ts,/this\.editorAccessKey\?\.nativeElement\.focus/);
 assert.match(ts,/this\.focusEditorAccess\(\)/);
 assert.doesNotMatch(ts,/localStorage\.(?:setItem|getItem)/);
 assert.doesNotMatch(ts,/sessionStorage\.(?:setItem|getItem)/);
});
test('visible access strip adapts to narrow screens',()=>{
 assert.match(css,/\.si-access-inputs\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(max-width:620px\)\{\.si-access-inputs\{grid-template-columns:1fr\}/);
});
