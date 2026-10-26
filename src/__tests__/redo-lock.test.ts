import {beforeEach,expect,it,vi} from 'vitest'
const db=vi.hoisted(()=>({rows:new Map<string,{claim_id:string;received_at:string}>()}))
vi.mock('@/lib/supabase/server',()=>({createServerClient:()=>({
 rpc:async(_n:string,a:any)=>{if(db.rows.has(a.p_message_id))return{data:false,error:null};db.rows.set(a.p_message_id,{claim_id:a.p_claim_id,received_at:new Date().toISOString()});return{data:true,error:null}},
 from:()=>{const f:any={op:'select',eq:{} as any};const b:any={select:()=>b,limit:()=>b,delete:()=>{f.op='delete';return b},eq:(k:string,v:string)=>{f.eq[k]=v;return b},then:(r:any)=>{const row=db.rows.get(f.eq.message_id);if(f.op==='select')return Promise.resolve({data:row?[row]:[],error:null}).then(r);if(row&&(!f.eq.claim_id||row.claim_id===f.eq.claim_id))db.rows.delete(f.eq.message_id);return Promise.resolve({data:null,error:null}).then(r)}};return b}})}))
import {acquireRedoLock,REDO_LOCK_STALE_MS} from '@/lib/spectrum/redo-lock'
beforeEach(()=>db.rows.clear())
it('an old job releasing after its stale lock was replaced cannot delete the replacement lock',async()=>{
 const a=await acquireRedoLock('c','h');expect(a.state).toBe('acquired')
 const later=()=>Date.now()+REDO_LOCK_STALE_MS+1000
 const b=await acquireRedoLock('c','h',later);expect(b.state).toBe('acquired')
 if(a.state==='acquired')await a.release()
 expect(db.rows.has('redo-lock:h')).toBe(true)
 if(b.state==='acquired')await b.release();expect(db.rows.has('redo-lock:h')).toBe(false)
})
it('two concurrent acquirers: exactly one wins; two recoverers of a stale lock: exactly one wins',async()=>{
 const [x,y]=await Promise.all([acquireRedoLock('c','h'),acquireRedoLock('c','h')]);expect([x.state,y.state].sort()).toEqual(['acquired','held'])
 db.rows.set('redo-lock:s',{claim_id:'dead',received_at:new Date(Date.now()-REDO_LOCK_STALE_MS-5000).toISOString()})
 const [p,q]=await Promise.all([acquireRedoLock('c','s'),acquireRedoLock('c','s')]);expect([p.state,q.state].sort()).toEqual(['acquired','held'])
})
