import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),port=process.env.PORT||'3200',host=process.env.HOST||'0.0.0.0';
if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw Error('PORT must be between 1 and 65535.');
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--port',port,'--hostname',host],{stdio:'inherit',env:process.env});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>{console.error('Unable to start the production server. Build the app first.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
