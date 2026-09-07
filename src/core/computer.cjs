const { spawn } = require('node:child_process');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
function validateAction(args) {
  if (!args || typeof args !== 'object') throw new Error('Invalid computer action.');
  const action = args.action;
  if (['click','move'].includes(action)) {
    if (![args.x,args.y].every(n => Number.isFinite(n) && n >= 0 && n < 32768)) throw new Error('Provide valid screen coordinates.');
    const button = args.button || 'left'; if (!['left','right','middle'].includes(button)) throw new Error('Invalid mouse button.');
    return { action, x:args.x, y:args.y, button };
  }
  if (action === 'scroll') { if (!Number.isInteger(args.steps) || !args.steps || Math.abs(args.steps)>10) throw new Error('Scroll by 1–10 steps.'); return {action, steps:args.steps}; }
  if (action === 'type') { if (typeof args.text!=='string' || !args.text || args.text.length>2000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(args.text)) throw new Error('Type up to 2,000 characters without control codes.'); return {action,text:args.text}; }
  if (action === 'key') { if (typeof args.key!=='string' || !/^(?:(?:CTRL|ALT|SHIFT|SUPER)\+){0,3}(?:Enter|Tab|Escape|Backspace|Delete|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|[a-zA-Z0-9])$/.test(args.key)) throw new Error('Use a supported key such as Enter or CTRL+l.'); return {action,key:args.key}; }
  throw new Error('Unsupported computer action.');
}
class Computer {
  constructor({ onChange = () => {}, spawnProcess = spawn } = {}) { this.onChange=onChange; this.spawnProcess=spawnProcess; this.pending=new Map(); this.status='disconnected'; this.error=''; }
  snapshot() { return {status:this.status,error:this.error,backend:'Linux desktop portal'}; }
  changed() { this.onChange(this.snapshot()); }
  start() {
    if (this.child) return;
    const env=Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)));
    const child=this.spawnProcess('/usr/bin/python3',['-u',path.join(__dirname,'../native/computer_portal.py')],{env,stdio:['pipe','pipe','pipe']});
    this.child=child; let buffer='', diagnostic='';
    child.stderr.on('data', c => { diagnostic=(diagnostic+c).slice(-1200); });
    child.stdout.on('data', c => {
      buffer+=c.toString(); if(buffer.length>12000000){this.disconnect();return;}
      let end; while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let r;try{r=JSON.parse(line);}catch{continue;}
        if(r.event==='closed'){this.disconnect();return;}
        const p=this.pending.get(r.id); if(p){this.pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(new Error(r.error)):p.resolve(r.result);}
      }
    });
    const failed=message => { if(this.child!==child)return;this.child=null;this.status='error';this.error=message;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(message));}this.pending.clear();this.changed(); };
    child.on('error',()=>failed('Cannot start desktop helper. Install Python 3, PyGObject, GStreamer, and the PipeWire plugin.'));
    child.on('close',()=>failed(diagnostic.includes('ModuleNotFoundError')||diagnostic.includes('Namespace Gst not available')?'Desktop dependencies are missing. See Computer setup.':'Desktop sharing ended. Connect again.'));
  }
  request(method,args={}) {
    this.start();return new Promise((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Desktop operation timed out. Connect again.'));this.disconnect();},method==='connect'?100000:15000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,args})+'\n',error=>{if(error){const p=this.pending.get(id);if(p){clearTimeout(timer);this.pending.delete(id);reject(error);}}});});
  }
  async connect() { if(this.status==='connected')return this.snapshot();if(this.status==='connecting')throw new Error('Complete the desktop permission dialog first.');this.status='connecting';this.error='';this.changed();try{await this.request('connect');if(this.status!=='connecting')throw new Error('Desktop connection canceled.');this.status='connected';this.changed();return this.snapshot();}catch(error){const canceled=this.status==='disconnected';this.disconnect();if(!canceled){this.status='error';this.error=error.message;this.changed();}throw error;} }
  require() { if(this.status!=='connected')throw new Error('Connect your screen in Computer mode first.'); }
  async screenshot(signal) { this.require();signal?.throwIfAborted();const r=await this.request('screenshot');signal?.throwIfAborted();return r; }
  async action(args,signal) { this.require();const safe=validateAction(args);signal?.throwIfAborted();const stop=()=>this.disconnect();signal?.addEventListener('abort',stop,{once:true});try{return await this.request('action',safe);}finally{signal?.removeEventListener('abort',stop);} }
  disconnect() { const child=this.child;this.child=null;child?.stdin.end();child?.kill('SIGTERM');if(child){const timer=setTimeout(()=>child.kill('SIGKILL'),1000);timer.unref();child.once('close',()=>clearTimeout(timer));}for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Desktop disconnected.'));}this.pending.clear();this.status='disconnected';this.error='';this.changed(); }
}
const computerTools = [
 {type:'function',function:{name:'computer_screenshot',description:'Request approval to capture the shared monitor. The image is sent to your model. Use its pixel coordinates for subsequent pointer actions. Take a fresh screenshot before each action and verify the result.',parameters:{type:'object',properties:{},additionalProperties:false}}},
 {type:'function',function:{name:'computer_action',description:'Request approval for one desktop action. Click coordinates refer to the latest screenshot. Supported actions: click, move, type, key, scroll. Never enter secrets or approve your own permission dialogs. Explain sensitive actions to the user.',parameters:{type:'object',properties:{action:{type:'string',enum:['click','move','type','key','scroll']},x:{type:'number'},y:{type:'number'},button:{type:'string',enum:['left','right','middle']},text:{type:'string'},key:{type:'string',description:'Enter, Tab, Escape, CTRL+l, ALT+Tab, etc.'},steps:{type:'integer',minimum:-10,maximum:10}},required:['action'],additionalProperties:false}}}
];
module.exports={Computer,validateAction,computerTools};
