import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.TEST_URL||'http://localhost:3200';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
await mkdir('artifacts',{recursive:true});
const errors=[],requests=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(r.url());});
 await page.goto(base+'/app');await page.waitForURL(/\/login(?:\?|$)/);await page.getByRole('heading',{name:'Welcome back.'}).waitFor();
 const headers=(await page.request.get(base+'/login')).headers();assert.match(headers['content-security-policy'],/frame-ancestors 'none'/);assert.equal(headers['x-content-type-options'],'nosniff');
 await page.screenshot({path:'artifacts/login-desktop.png',fullPage:true});
 await page.getByLabel('Email address',{exact:true}).fill('test@example.com');await page.getByLabel('Password',{exact:true}).fill('StrongPass123');
 await page.getByRole('button',{name:'Show password',exact:true}).click();await page.waitForFunction(()=>document.querySelector('input[autocomplete="current-password"]').type==='text');
 await page.getByRole('button',{name:'Hide password',exact:true}).click();
 const disabledCloud=await page.locator('.connection-note').isVisible();
 if(disabledCloud){await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('alert').filter({hasText:'Connect the new Supabase project'}).waitFor();}
 await page.goto(base+'/signup');await page.getByRole('heading',{name:'Your next advantage.'}).waitFor();assert.equal(await page.getByLabel('Password',{exact:true}).getAttribute('minlength'),'10');
 await page.getByLabel('Full name',{exact:true}).fill('Test Buyer');await page.getByLabel('Email address',{exact:true}).fill('buyer@example.com');await page.getByLabel('Password',{exact:true}).fill('StrongPass123');
 await page.getByLabel('Confirm password',{exact:true}).fill('StrongPass123');
 if(disabledCloud){await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByRole('alert').filter({hasText:'Connect the new Supabase project'}).waitFor();}
 await page.screenshot({path:'artifacts/signup-desktop.png',fullPage:true});
 await page.goto(base+'/forgot-password');await page.getByRole('heading',{name:'Reset your password.'}).waitFor();
 await page.goto(base+'/demo');await page.getByRole('heading',{name:'Every quote. One clear view.'}).waitFor();await page.getByRole('button',{name:'Northline Supply',exact:true}).waitFor();
 await page.screenshot({path:'artifacts/workspace-desktop.png',fullPage:true});
 const canvas=await page.locator('canvas').evaluate(el=>{const data=el.getContext('2d').getImageData(0,0,el.width,el.height).data;let painted=0;for(let i=3;i<data.length;i+=4)if(data[i])painted++;return painted;});assert.ok(canvas>100,'cost chart canvas has rendered pixels');
 await page.getByRole('button',{name:'Add quotation',exact:true}).click();await page.getByLabel('Supplier name',{exact:true}).fill('Browser Supplier');await page.getByLabel('Quote reference',{exact:true}).fill('TEST-01');
 await page.getByLabel('Import CSV',{exact:true}).setInputFiles({name:'quote.csv',mimeType:'text/csv',buffer:Buffer.from('item,quantity,unit_price\n"Chair, blue",2,125')});
 await page.waitForFunction(()=>document.querySelector('input[aria-label="Item 1"]').value==='Chair, blue');
 await page.getByRole('button',{name:'Apply quotation',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 assert.equal(await page.getByRole('button',{name:'Analyze quotations',exact:true}).isDisabled(),true,'unsaved data cannot trigger AI');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved in the demo'}).waitFor();
 await page.reload();await page.getByRole('button',{name:'Browser Supplier',exact:true}).waitFor();
 await page.getByRole('button',{name:'Shortlist supplier',exact:true}).last().click();await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('button',{name:'Decision brief',exact:true}).last().click();await page.getByRole('heading',{name:'Browser Supplier',exact:true}).waitFor();
 await page.getByRole('button',{name:'Analyze quotations',exact:true}).click();await page.getByText('DEMO REVIEW / SAMPLE OUTPUT',{exact:false}).waitFor();await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('button',{name:'New request',exact:true}).click();await page.getByLabel('Request title',{exact:true}).fill('Browser request');await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.reload();await page.getByLabel('Active purchase request').selectOption({label:'Browser request'});await page.getByRole('heading',{name:'No quotations yet',exact:true}).waitFor();
 await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('button',{name:'Purchase requests',exact:true}).click();
 await page.getByLabel('Search purchase requests',{exact:true}).fill('Browser request');await page.getByRole('button',{name:'Open Browser request',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Open Workspace furniture refresh',exact:true}).count(),0);
 await page.evaluate(()=>localStorage.removeItem('quotient-demo-v2'));await page.reload();
 await page.getByRole('button',{name:'Shortlist supplier',exact:true}).first().click();await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('button',{name:'Submit for approval',exact:true}).click();await page.getByLabel('Decision note',{exact:true}).fill('Ready for review.');await page.getByRole('button',{name:'Confirm status',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 assert.equal(await page.getByLabel('Purchase title',{exact:true}).isDisabled(),true,'submitted requests are locked');
 await page.getByRole('button',{name:'Approve shortlist',exact:true}).click();await page.getByRole('button',{name:'Confirm status',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('button',{name:'Reopen as draft',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Add quotation',exact:true}).isDisabled(),true,'approved quotations are locked');
 await page.getByRole('button',{name:'Reopen as draft',exact:true}).click();await page.getByRole('button',{name:'Confirm status',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.getByLabel('Purchase title',{exact:true}).isDisabled(),false);
 const backupPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download JSON backup',exact:true}).click();assert.equal((await backupPromise).suggestedFilename(),'quotient-request.json');
 await page.getByRole('button',{name:'Duplicate request',exact:true}).click();assert.match(await page.getByLabel('Purchase title',{exact:true}).inputValue(),/copy/);await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.evaluate(()=>localStorage.removeItem('quotient-demo-v2'));await page.reload();
 for(const width of [360,390,768,1024,1440]){
  await page.setViewportSize({width,height:900});
  for(const route of ['/login','/signup','/forgot-password','/reset-password','/demo']){
   await page.goto(base+route);await page.locator('h1').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow: ${route} ${width}`);
   if(width===390&&['/login','/demo'].includes(route))await page.screenshot({path:`artifacts/${route.slice(1)}-mobile.png`,fullPage:true});
  }
 }
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/demo');await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('dialog',{name:'Mobile navigation',exact:true}).waitFor();
 await page.getByRole('navigation',{name:'Mobile navigation',exact:true}).getByRole('button',{name:'Team & access',exact:true}).click();await page.getByRole('heading',{name:'Built for your team.'}).waitFor();assert.equal(await page.getByRole('dialog',{name:'Mobile navigation',exact:true}).isVisible(),false);
 await page.getByRole('button',{name:'Invite member',exact:true}).click();await page.getByLabel('Email address',{exact:true}).fill('member@example.demo');await page.getByRole('button',{name:'Create invite link',exact:true}).click();await page.getByLabel('Invitation link',{exact:true}).waitFor();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('navigation',{name:'Mobile navigation',exact:true}).getByRole('button',{name:'Workspace settings',exact:true}).click();await page.getByRole('heading',{name:'Organization details',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(requests,[],'auth unavailable and demo do not call application APIs');
 const review=await page.request.post(base+'/api/review',{headers:{Origin:base},data:{organization:'00000000-0000-4000-8000-000000000001',purchase:'00000000-0000-4000-8000-000000000002',version:1}});assert.ok([401,403,503].includes(review.status()),'unauthenticated AI is denied');
 assert.deepEqual(errors,[],'no browser runtime errors');
 await writeFile('artifacts/browser-results.json',JSON.stringify({status:'passed',widths:[360,390,768,1024,1440],checks:['auth screens','password visibility','protected /app redirect','CSV import','explicit save and persistence','shortlist','simulated AI isolation','new purchase','mobile team navigation','invitation preview','responsive layouts','nonblank cost chart','unauthenticated AI denied','no runtime errors','security headers','request search','approval/reopen locking','JSON backup','duplicate request'],liveSupabaseVerified:false},null,2));
 console.log('Browser checks passed. Real email delivery and signed-in cloud workflows are separate launch checks.');
}finally{await browser.close();}
