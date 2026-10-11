'use client'
import {useEffect,useRef} from 'react'
/** Fixed bridge, state only. The saved page and generated worker remain opaque. */
export function SavedPage({html,fileId}:{html:string;fileId:string}){
 const ref=useRef<HTMLIFrameElement>(null)
 useEffect(()=>{
  const prefix=`dinghy-saved-page:${fileId}:`
  const receive=(e:MessageEvent)=>{
   if(e.source!==ref.current?.contentWindow||!e.data||typeof e.data.key!=='string'||!/^[a-f0-9]{24}$/.test(e.data.key))return
   if(typeof e.data.stateKey!=='string'||!/^[a-f0-9]{24}$/.test(e.data.stateKey))return
   const storage=prefix+e.data.stateKey
   if(e.data.kind==='dinghy-pages-saved-ready'){
    let state={};try{state=JSON.parse(localStorage.getItem(storage)||'{}')}catch{}
    ref.current?.contentWindow?.postMessage({kind:'dinghy-pages-saved-init',key:e.data.key,state},'*')
   }
   if(e.data.kind==='dinghy-pages-saved-state'&&e.data.state&&typeof e.data.state==='object'&&JSON.stringify(e.data.state).length<=12000){try{localStorage.setItem(storage,JSON.stringify(e.data.state))}catch{}}
  }
  window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)
 },[fileId])
 return <iframe ref={ref} title="Saved interactive page" sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={()=>ref.current?.contentWindow?.postMessage({kind:'dinghy-pages-saved-request'},'*')} srcDoc={html} style={{width:'100%',height:800,border:0}}/>
  }
