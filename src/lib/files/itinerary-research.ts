import {sourceScore,isHubUrl} from './itinerary-mentions'
import {buildPageView,FOOD_NAME} from './itinerary-view'
import type {SourceRecords} from './source-records'
/** Research leads are ranked, not treated as venue evidence. */
export function widenQuery(kind:string,destination:string,attempt=0):string{
 if(attempt>0)return kind==='restaurant'?`${destination} restaurant recommendations cafes bistros dining essential restaurants`:kind==='activity'?`${destination} museums gardens attractions places to visit travel guide`:`${destination} hotels lodging recommendations`
 return kind==='restaurant'?`best restaurants in ${destination} where to eat restaurant guide -hotels -festival -events -deals`:kind==='hotel'?`best hotels in ${destination} where to stay guide`:`best things to do in ${destination} attractions museums gardens guide -hotels -festival -events -deals`
}
const DINING_SHELL=/\b(?:deals?|events?|festivals?|celebrations?|accessibility|accessible|menus?|restaurant months|spice months)\b/i
export function widenSourceScore(kind:string,url:string,title:string):number{
 if(isHubUrl(url))return -10
 const words=(url+' '+title).replace(/[-_/]/g,' ')
 let score=sourceScore(url,title)
 if(kind==='activity'&&/\b(?:events?|festivals?|celebrations?|deals?|accessibility)\b/i.test(words))score-=5
 if(kind==='restaurant'){
  if(DINING_SHELL.test(words))score-=5
  if(/\b(?:best restaurants|where to eat|restaurant guide|restaurants in)\b/i.test(words))score+=3
 }
 return score
}
/** Only a read page with named venue evidence earns a stop slot. Chrome-only pages never do. */
export function diningPageEvidence(records:SourceRecords,ids:string[]):{usable:boolean;venueLines:number;score:number}{
 const skip=new Set(records.pageIds().filter(id=>!ids.includes(id)))
 const view=buildPageView(records,9000,24000,skip)
 const venueLines=new Set(view.entries.filter(e=>e.ctx!=='hotel'&&e.ctx!=='activity'&&(e.ctx==='restaurant'||FOOD_NAME.test(e.name)||/\b(?:restaurant|cafe|café|bar|grill|kitchen|bistro|steakhouse|serves|cuisine|dining)\b/i.test(e.text))).map(e=>e.name.toLowerCase())).size
 const shell=ids.some(id=>DINING_SHELL.test(((records.pageTitle(id)||'')+' '+(records.pageUrl(id)||'')).replace(/[-_/]/g,' ')))
 // A menu-only/special-offer page is not a shortlist; a genuine multi-venue guide can still be useful.
 return {usable:venueLines>0&&(!shell||venueLines>=3),venueLines,score:venueLines*3-(shell?5:0)}
}

/** Activity pages need actual named attraction lines, not a readable festival or destination shell. */
export function activityPageEvidence(records:SourceRecords,ids:string[]):{usable:boolean;venueLines:number;score:number}{
 const skip=new Set(records.pageIds().filter(id=>!ids.includes(id)))
 const view=buildPageView(records,9000,24000,skip)
 const venueLines=new Set(view.entries.filter(e=>e.ctx!=='hotel'&&e.ctx!=='restaurant'&&(e.ctx==='activity'||/\b(?:museum|gallery|gardens?|park|aquarium|zoo|castle|theat(?:er|re)|tours?|exhibits?|murals|attraction)\b/i.test(e.name+' '+e.text))).map(e=>e.name.toLowerCase())).size
 const shell=ids.some(id=>/\b(?:events?|festivals?|celebrations?|deals?|accessibility)\b/i.test(((records.pageTitle(id)||'')+' '+(records.pageUrl(id)||'')).replace(/[-_/]/g,' ')))
 return {usable:venueLines>0&&(!shell||venueLines>=3),venueLines,score:venueLines*3-(shell?5:0)}
}
