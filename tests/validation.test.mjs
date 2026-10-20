import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePurchase} from '../lib/validation.ts';
import {samples} from '../lib/quotes.ts';
test('validates supplier selection and rejects duplicate and invalid quote data',()=>{
 assert.equal(validatePurchase({title:' Office ',quotes:samples,selected:'north'}).title,'Office');
 assert.throws(()=>validatePurchase({title:'Office',quotes:samples,selected:'missing'}));
 const duplicate=structuredClone(samples);duplicate[0].items.push({...duplicate[0].items[0]});
 assert.throws(()=>validatePurchase({title:'Office',quotes:duplicate,selected:''}));
 const bad=structuredClone(samples);bad[0].currency='NOT-A-CURRENCY';assert.throws(()=>validatePurchase({title:'Office',quotes:bad,selected:''}));
});
