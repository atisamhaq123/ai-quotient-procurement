for(let attempt=0;attempt<30;attempt++){try{const res=await fetch('http://localhost:3200/api/health',{signal:AbortSignal.timeout(1000)});if(res.ok)process.exit(0);}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
throw Error('Preview did not start within 30 seconds.');
