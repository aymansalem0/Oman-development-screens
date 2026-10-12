import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
const html=read('src/app/pages/si-candidate-workbench.component.html');
const ts=read('src/app/pages/si-candidate-workbench.component.ts');
const css=read('src/app/pages/si-candidate-workbench.component.css');
test('operator and masked Editor key appear above same C01 grid controls',()=>{
 const head=html.indexOf('class="si-panel si-unified-queue"');
 const inputs=html.indexOf('class="si-compact-credentials"');
 const editor=html.indexOf('#editorAccessKey');
 const name=html.indexOf('[(ngModel)]="reviewer"');
 const generate=html.indexOf('(click)="generateInspectionPlan()"');
 const grid=html.indexOf('class="si-unified-table"');
 assert.ok(head>=0&&head<inputs&&inputs<name&&name<editor&&editor<generate&&generate<grid);
 assert.equal(html.split('[(ngModel)]="editorKey"').length-1,1);
 assert.equal(html.split('[(ngModel)]="publisherKey"').length-1,1);
 assert.equal(html.split('[(ngModel)]="reviewer"').length-1,1);
 assert.doesNotMatch(html,/class="si-panel si-c01-panel"/);
});
test('Editor / Publisher keys masked, never put into local/session storage',()=>{
 assert.match(html,/#editorAccessKey type="password"/);
 assert.match(html,/type="password" \[\(ngModel\)\]="publisherKey"/);
 assert.match(ts,/this\.editorAccessKey\?\.nativeElement\.focus/);
 assert.match(ts,/this\.focusEditorAccess\(\)/);
 assert.doesNotMatch(ts,/localStorage\.(?:setItem|getItem)/);
 assert.doesNotMatch(ts,/sessionStorage\.(?:setItem|getItem)/);
});
test('compact access toolbar and grid remain accessible on small screens',()=>{
 assert.match(css,/\.si-compact-credentials\{display:flex/);
 assert.match(css,/@media\(max-width:550px\)/);
 assert.match(css,/\.si-unified-table\{/);
});
