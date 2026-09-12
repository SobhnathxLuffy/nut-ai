import { normalizeIndianAliases } from '@nutai/resolver'
export type SearchScope='food'|'recipe'|'saved_meal'|'exercise'|'action'
export interface SearchEntity {
  id:string; type:SearchScope; label:string; aliases:string[]; source:string; provenance:string;
  barcode?:string; favorite?:boolean; frequent?:number; last_used_at?:number; custom?:boolean;
  equipment?:string[]; muscles?:string[]; tracking_type?:string; previous?:string; coverage?:number
}
export interface SearchInput {query:string;locale:string;scopes:SearchScope[];limit:number;offset?:number;allowEmpty?:boolean;filters?:{source?:string;favorite?:boolean;recent?:boolean;frequent?:boolean;equipment?:string[];muscle?:string;coverage?:number}}
export interface SearchResult extends SearchEntity {score:number;matched_tokens:string[]}
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()
export function rankSearch(entities:readonly SearchEntity[],input:SearchInput):{results:SearchResult[];hasMore:boolean} {
  if(!Number.isInteger(input.limit)||input.limit<1||input.limit>100||!Number.isInteger(input.offset??0)||(input.offset??0)<0)throw new Error('Invalid search page')
  const query=normalize(input.query);const expanded=normalize(normalizeIndianAliases(input.query));const tokens=expanded.split(' ').filter(Boolean)
  if(!query&&!input.allowEmpty)return {results:[],hasMore:false}
  const results:SearchResult[]=[]
  for(const e of entities){
    const f=input.filters
    if(!input.scopes.includes(e.type)||f?.source&&e.source!==f.source||f?.favorite&&!e.favorite||f?.recent&&!e.last_used_at||f?.frequent&&!(e.frequent&&e.frequent>1)||f?.muscle&&!e.muscles?.includes(f.muscle)||f?.coverage!==undefined&&(e.coverage===undefined||e.coverage<f.coverage))continue
    if(f?.equipment && e.equipment?.some(eq=>!f.equipment!.includes(eq)))continue
    const label=normalize(e.label),aliases=e.aliases.map(normalize),all=[label,...aliases].join(' ')
    const matched=tokens.filter(t=>all.includes(t))
    const aliasExact=aliases.includes(query)||aliases.includes(expanded),exact=label===query||label===expanded
    if(query && !aliasExact && !exact && matched.length!==tokens.length)continue
    let score=e.barcode===input.query&&query?10000:exact?1000:aliasExact?950:500
    score+=e.source==='recipe'?80:e.source==='ifct'?60:e.custom?50:0
    score+=e.favorite?30:0;score+=Math.min(e.frequent??0,20)
    if(e.custom&&e.type==='exercise')score+=100
    results.push({...e,score,matched_tokens:aliasExact?[input.query]:matched})
  }
  results.sort((a,b)=>b.score-a.score||(b.last_used_at??0)-(a.last_used_at??0)||a.label.localeCompare(b.label,'en')||a.id.localeCompare(b.id,'en'))
  const offset=input.offset??0
  return {results:results.slice(offset,offset+input.limit),hasMore:results.length>offset+input.limit}
}
