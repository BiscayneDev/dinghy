import type {PublishedSite} from './share'
export type ImageryState = {page:'fallback'|'ready';chat:'fallback'|'ready';share:'fallback'|'ready';metadata:'verified'|'unverified';reason?:string}
/** Optional read/render work can time out. Never wrap a site mutation in this:
 * a timed-out write can still land and overwrite a newer version. */
export async function optionalWithin<T>(work:Promise<T>,ms:number,fallback:T):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined
 try{return await Promise.race([work.catch(()=>fallback),new Promise<T>(r=>{timer=setTimeout(()=>r(fallback),ms)})])}finally{if(timer)clearTimeout(timer)}
}
/** Read only the assigned hosted site. No remote title-bearing image request. */
export async function verifyShareMetadata(site:PublishedSite,expectedImage:string|null,expectedTitle?:string,expectedVideo:string|null=null):Promise<boolean>{
 try{
  const u=new URL(site.url)
  if(u.protocol!=='https:'||u.hostname!==`${site.slug}.here.now`||u.username||u.password)return false
  const res=await fetch(u.href,{redirect:'error',signal:AbortSignal.timeout(2500),headers:{'Cache-Control':'no-cache'}})
  if(!res.ok)return false
  const html=await res.text()
  const image=html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i)?.[1]?.replace(/&amp;/g,'&')??null
  const video=html.match(/<meta\s+property="og:video"\s+content="([^"]*)"/i)?.[1]?.replace(/&amp;/g,'&')??null
  if(video!==expectedVideo)return false
  const title=html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i)?.[1]?.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
  if(image!==expectedImage||!title||(expectedTitle!==undefined&&title!==expectedTitle))return false
  // Local enriched image must actually exist. Do not contact a remote image URL
  // carrying private page data merely to test the fallback.
  if(expectedImage&&new URL(expectedImage).hostname===u.hostname){
    const img=await fetch(expectedImage,{redirect:'error',signal:AbortSignal.timeout(1500)})
    if(!img.ok||!img.headers.get('content-type')?.startsWith('image/png'))return false
    const bytes=new Uint8Array(await img.arrayBuffer())
    if(bytes.length<24||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71)return false
  }
  return true
 }catch{return false}
}
