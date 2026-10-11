import type {PublishedSite} from './share'
export type ImageryState = {page:'fallback'|'ready';chat:'fallback'|'ready';share:'fallback'|'ready';metadata:'verified'|'unverified';reason?:string}
/** Optional read/render work can time out. Never wrap a site mutation in this:
 * a timed-out write can still land and overwrite a newer version. */
export async function optionalWithin<T>(work:Promise<T>,ms:number,fallback:T):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined
 try{return await Promise.race([work.catch(()=>fallback),new Promise<T>(r=>{timer=setTimeout(()=>r(fallback),ms)})])}finally{if(timer)clearTimeout(timer)}
}
/** Read only the assigned hosted site. No remote title-bearing image request. */
export async function verifyShareMetadata(site:PublishedSite,expectedImage:string|null):Promise<boolean>{
 try{
  const u=new URL(site.url)
  if(u.protocol!=='https:'||u.hostname!==`${site.slug}.here.now`||u.username||u.password)return false
  const res=await fetch(u.href,{redirect:'error',signal:AbortSignal.timeout(2500),headers:{'Cache-Control':'no-cache'}})
  if(!res.ok)return false
  const html=await res.text()
  const image=html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i)?.[1]?.replace(/&amp;/g,'&')??null
  return image===expectedImage&&html.includes('property="og:title"')
 }catch{return false}
}
