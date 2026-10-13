import {AsyncLocalStorage} from 'node:async_hooks'
type Entry={kind:string;data:unknown}
const scope=new AsyncLocalStorage<Entry[]>()
/** Admin synthetic invocation only. No global retention, logs, database or artifact writes. */
export async function withItineraryDiagnostic<T>(run:()=>Promise<T>):Promise<{result:T;diagnostic:Entry[]}>{
 const entries:Entry[]=[]
 const result=await scope.run(entries,run)
 return {result,diagnostic:entries}
}
export function captureItineraryDiagnostic(kind:string,data:unknown):void{
 const entries=scope.getStore();if(!entries||entries.length>=100)return
 entries.push({kind,data:JSON.parse(JSON.stringify(data))})
}
