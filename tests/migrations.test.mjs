import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
test('fresh installation exposes exactly one transactional migration',async()=>{
 const directory=new URL('../supabase/migrations/',import.meta.url);
 assert.deepEqual((await readdir(directory)).filter(name=>name.endsWith('.sql')),['001_setup.sql']);
 const sql=await readFile(new URL('001_setup.sql',directory),'utf8');
 assert.equal((sql.match(/^begin;$/gm)||[]).length,1);
 assert.equal((sql.match(/^commit;$/gm)||[]).length,1);
});
