import {test} from 'node:test';
import assert from 'node:assert/strict';
import {total,parseCSV,samples} from '../lib/quotes.ts';
test('totals apply tax to item subtotal and add shipping once',()=>{assert.equal(total({...samples[0],items:[{name:'Chair',qty:2,price:100}],tax:10,shipping:30}),250);});
test('imports quoted names and escaped quotes',()=>{assert.deepEqual(parseCSV('item,quantity,unit_price\r\n"Chair, blue",2,19.50\r\n"24"" monitor",1,100'),[{name:'Chair, blue',qty:2,price:19.5},{name:'24" monitor',qty:1,price:100}]);});
test('rejects invalid CSV values and headers',()=>{for(const csv of ['name,qty,price\na,1,2','item,quantity,unit_price\na,,10','item,quantity,unit_price\na,-1,10','item,quantity,unit_price\n"broken,2,10'])assert.throws(()=>parseCSV(csv));});
