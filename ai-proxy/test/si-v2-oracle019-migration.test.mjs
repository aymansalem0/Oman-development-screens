import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(
 new URL('../migrations/019_si_schedule_approval_and_assignment.sql',import.meta.url),
 'utf8');

test('Oracle 019 bootstraps a newly created mutex with dynamic SQL',()=>{
 // PL/SQL must not compile a static SQL statement referring to the mutex
 // before ensure_table has created it at runtime on an empty schema.
 assert.match(sql,/ensure_table\('SI_V2_SCHEDULE_MUTEX',[\s\S]*?CREATE TABLE SI_V2_SCHEDULE_MUTEX/);
 assert.match(sql,/EXECUTE IMMEDIATE\s*'SELECT COUNT\(\*\) FROM SI_V2_SCHEDULE_MUTEX WHERE LOCK_ID = :lock_id'\s*INTO n USING 1;/);
 assert.match(sql,/EXECUTE IMMEDIATE\s*'INSERT INTO SI_V2_SCHEDULE_MUTEX \(LOCK_ID\) VALUES \(:lock_id\)'\s*USING 1;/);
 assert.doesNotMatch(sql,/^\s*SELECT COUNT\(\*\) INTO n FROM SI_V2_SCHEDULE_MUTEX/m);
 assert.doesNotMatch(sql,/^\s*IF n=0 THEN INSERT INTO SI_V2_SCHEDULE_MUTEX/m);
});

test('Oracle 019 is additive and includes schedule approval objects',()=>{
 for(const table of ['SI_V2_SCHEDULE_MUTEX','SI_V2_SCHEDULE_APPROVAL',
  'SI_V2_SCHEDULE_ASSIGNMENT','SI_V2_SCHEDULE_AUDIT']){
  assert.match(sql,new RegExp("ensure_table\\('"+table+"'"));
 }
 assert.match(sql,/WHENEVER SQLERROR EXIT SQL\.SQLCODE/);
 assert.match(sql,/SELECT COUNT\(\*\) INTO n FROM USER_TABLES WHERE TABLE_NAME=p_name/);
 assert.match(sql,/COMMIT;/);
});
