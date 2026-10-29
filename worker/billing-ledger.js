import Billing from '../arena-billing.js';

const initialized=new WeakSet();
const reply=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
function initialize(ctx){
  if(initialized.has(ctx))return;
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS billing_receipts (id TEXT PRIMARY KEY, owner TEXT NOT NULL, at INTEGER NOT NULL, model TEXT NOT NULL, parent_id TEXT, value TEXT NOT NULL)');
  ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS billing_owner_at ON billing_receipts (owner, at)');
  ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS billing_owner_parent ON billing_receipts (owner, parent_id)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS billing_totals (owner TEXT NOT NULL, model TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (owner, model))');
  initialized.add(ctx);
}
const blank=()=>({calls:0,input:0,output:0,missingInput:0,missingOutput:0,unsettled:0,knownCostPico:'0',completeCostPico:'0',firstAt:null,lastAt:null});
function accumulate(total,value){
  total.calls++;
  if(value.input===null)total.missingInput++;else total.input+=value.input;
  if(value.output===null)total.missingOutput++;else total.output+=value.output;
  if(!value.billingComplete)total.unsettled++;
  total.knownCostPico=(BigInt(total.knownCostPico)+BigInt(value.knownCostPico||'0')).toString();
  total.completeCostPico=(BigInt(total.completeCostPico)+BigInt(value.costPico||'0')).toString();
  total.firstAt=total.firstAt===null?value.at:Math.min(total.firstAt,value.at);
  total.lastAt=total.lastAt===null?value.at:Math.max(total.lastAt,value.at);
  return total;
}
function addTotals(a,b){
  for(const key of ['calls','input','output','missingInput','missingOutput','unsettled'])a[key]+=b[key];
  for(const key of ['knownCostPico','completeCostPico'])a[key]=(BigInt(a[key])+BigInt(b[key])).toString();
  if(b.firstAt!==null)a.firstAt=a.firstAt===null?b.firstAt:Math.min(a.firstAt,b.firstAt);
  if(b.lastAt!==null)a.lastAt=a.lastAt===null?b.lastAt:Math.max(a.lastAt,b.lastAt);
  return a;
}
function displayTotals(value){
  return {...value,knownCostUsd:Billing.usd(value.knownCostPico),completeCostUsd:Billing.usd(value.completeCostPico),billingComplete:value.unsettled===0};
}
export async function handleBillingLedger(ctx,request){
  if(request.method!=='POST')return reply({error:'Method not allowed'},405);
  let body;try{body=await request.json();}catch{return reply({error:'Invalid ledger request'},400);}
  initialize(ctx);
  const owner=typeof body.owner==='string'&&body.owner.length>0&&body.owner.length<=128&&!/[\u0000-\u001f]/.test(body.owner)?body.owner:null;
  if(body.action==='record'){
    const value=body.receipt;
    if(!owner||!value||value.schemaVersion!==2||typeof value.id!=='string'||!/^[a-zA-Z0-9:_-]{8,160}$/.test(value.id)
      ||typeof value.model!=='string'||!Number.isSafeInteger(value.at)||value.auxiliary
      ||![value.input,value.output].every(n=>n===null||Billing.count(n)!==null)
      ||!/^\d+$/.test(value.knownCostPico)||!(value.costPico===null||/^\d+$/.test(value.costPico))
      ||typeof value.billingComplete!=='boolean')return reply({error:'Invalid usage receipt'},400);
    if(JSON.stringify(value).length>65536)return reply({error:'Usage receipt too large'},413);
    const write=()=>{
      const existing=ctx.storage.sql.exec('SELECT owner, value FROM billing_receipts WHERE id = ?',value.id).toArray()[0];
      if(existing){
        if(existing.owner!==owner||existing.value!==JSON.stringify(value))throw new Error('Usage receipt id collision');
        return true;
      }
      ctx.storage.sql.exec('INSERT INTO billing_receipts (id, owner, at, model, parent_id, value) VALUES (?, ?, ?, ?, ?, ?)',value.id,owner,value.at,value.model,value.parentId||null,JSON.stringify(value));
      const saved=ctx.storage.sql.exec('SELECT value FROM billing_totals WHERE owner = ? AND model = ?',owner,value.model).toArray()[0];
      const total=accumulate(saved?JSON.parse(saved.value):blank(),value);
      ctx.storage.sql.exec('INSERT INTO billing_totals (owner, model, value) VALUES (?, ?, ?) ON CONFLICT(owner, model) DO UPDATE SET value = excluded.value',owner,value.model,JSON.stringify(total));
      return false;
    };
    try{const duplicate=ctx.storage.transactionSync(write);return reply({ok:true,duplicate});}
    catch(error){return reply({error:error.message},409);}
  }
  if(body.action==='summary'){
    if(!owner&&!body.global)return reply({error:'Missing owner'},400);
    const rows=owner?ctx.storage.sql.exec('SELECT model, value FROM billing_totals WHERE owner = ?',owner).toArray()
      :ctx.storage.sql.exec('SELECT model, value FROM billing_totals').toArray();
    const models={},total=blank();
    for(const row of rows){const value=JSON.parse(row.value);models[row.model]=addTotals(models[row.model]||blank(),value);addTotals(total,value);}
    return reply({schemaVersion:2,scope:owner?'account':'global',total:displayTotals(total),models:Object.fromEntries(Object.entries(models).map(([id,value])=>[id,displayTotals(value)]))});
  }
  if(body.action==='receipt'){
    if(!owner||typeof body.id!=='string')return reply({error:'Missing receipt id'},400);
    const row=ctx.storage.sql.exec('SELECT value FROM billing_receipts WHERE owner = ? AND id = ?',owner,body.id).toArray()[0];
    if(!row)return reply({error:'用量明细不存在。'},404);
    const children=ctx.storage.sql.exec('SELECT value FROM billing_receipts WHERE owner = ? AND parent_id = ? ORDER BY at',owner,body.id).toArray();
    return reply({receipt:Billing.combine({...JSON.parse(row.value),ledgerStatus:'recorded'},children.map(child=>({...JSON.parse(child.value),ledgerStatus:'recorded'})))});
  }
  if(body.action==='receipts'){
    if(!owner)return reply({error:'Missing owner'},400);
    const rows=ctx.storage.sql.exec('SELECT value FROM billing_receipts WHERE owner = ? ORDER BY at DESC LIMIT 50',owner).toArray();
    return reply({receipts:rows.map(row=>JSON.parse(row.value))});
  }
  return reply({error:'Unknown ledger action'},400);
}
function binding(env){
  if(!env.CHAT_RUNS)throw new Error('Usage ledger binding is unavailable');
  return env.CHAT_RUNS.get(env.CHAT_RUNS.idFromName('billing-ledger-v1'),{locationHint:'enam'});
}
async function call(env,body){
  const response=await binding(env).fetch(new Request('https://usage-ledger.internal/__billing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  const value=await response.json();if(!response.ok)throw new Error(value.error||'Usage ledger unavailable');return value;
}
export async function recordProviderUsage(env,owner,model,raw,options={}){
  const receipt=Billing.receipt(model,raw,{...options,id:options.id||crypto.randomUUID()});
  if(options.parentId)receipt.parentId=options.parentId;
  // Record only counter metadata, never provider keys, prompts, images or replies.
  if(raw&&typeof raw==='object'){
    const allowed=['input_tokens','output_tokens','total_tokens','input_tokens_details','output_tokens_details','cache_read_input_tokens','cache_creation_input_tokens','cache_creation','server_tool_use','cost_in_usd_ticks',
      'promptTokenCount','cachedContentTokenCount','candidatesTokenCount','toolUsePromptTokenCount','thoughtsTokenCount','totalTokenCount','promptTokensDetails','cacheTokensDetails','candidatesTokensDetails','toolUsePromptTokensDetails','serviceTier'];
    receipt.providerUsage=Object.fromEntries(allowed.filter(key=>raw[key]!==undefined).map(key=>[key,raw[key]]));
  }
  const account=owner||'anonymous';
  try{await call(env,{action:'record',owner:account,receipt});return {...receipt,ledgerStatus:'recorded'};}
  catch{
    // An immutable receipt cannot lose a concurrent update, unlike KV read/modify/write totals.
    try{await env.BIZ_KV.put('billing:pending:'+account+':'+receipt.id,JSON.stringify(receipt));return {...receipt,ledgerStatus:'pending'};}
    catch{return {...receipt,ledgerStatus:'unrecorded'};}
  }
}
export async function usageSummary(env,owner,{global=false,recent=false}={}){
  // Recover safely retained receipts after a temporary ledger outage; replay is idempotent.
  if(owner&&env.BIZ_KV?.list){
    let cursor;
    do{
      const page=await env.BIZ_KV.list({prefix:global?'billing:pending:':'billing:pending:'+owner+':',limit:100,...(cursor?{cursor}:{})});
      for(const key of page.keys||[]){
        const raw=await env.BIZ_KV.get(key.name);if(!raw)continue;
        const receipt=JSON.parse(raw),account=global?key.name.slice('billing:pending:'.length,-receipt.id.length-1):owner;await call(env,{action:'record',owner:account,receipt});
      }
      cursor=page.list_complete===false?page.cursor:null;
    }while(cursor);
  }
  return call(env,{action:recent?'receipts':'summary',owner:global?null:owner,global:!!global});
}

export async function usageReceipt(env,owner,id){return call(env,{action:'receipt',owner,id});}
