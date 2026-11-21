import {createHash} from "node:crypto";
import {HOLDING_MODEL_VERSION,HOLDING_SJT_CASES} from "./holding";

export function holdingKeyFingerprint(value:unknown):string {
  const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v && typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
import {sameJsonValue,verifyScoringConfig,type ScoringConfig,type QuestionInput} from "./scoring";

/** Append-only interpretation upgrade; changing a correct option requires a separate reviewed change. */
export function buildHoldingScoringKey(original:ScoringConfig,questions:QuestionInput[]):ScoringConfig {
  if(original.mode === 'effectiveness') throw Error('Формула effectiveness не соответствует 28-балльному тесту');
  const ids=new Set(questions.map(q=>q.id));
  if(questions.length!==14 || HOLDING_SJT_CASES.some(c=>!ids.has(c.questionId))) throw Error('Кейсы не соответствуют исходной форме Холдинга');
  const items:ScoringConfig['items']={};
  for(const c of HOLDING_SJT_CASES){
    const item=original.items[c.questionId];
    if(!item || item.most!==c.mostOptionId || item.least!==c.leastOptionId) throw Error('Исходный ключ не совпадает с ID вариантов в файле Холдинга: '+c.questionId);
    const {competency,...rest}=item;
    items[c.questionId]={...rest,competencyCode:c.competencyCode,indicatorCode:c.indicatorCode,additionalIndicatorCode:c.additionalIndicatorCode};
  }
  const config={...original,items,holdingModelVersion:HOLDING_MODEL_VERSION};
  verifyScoringConfig(config,questions);
  return config;
}

export function holdingKeyInstallAction(existing:{config:unknown}|null,config:ScoringConfig):'create'|'unchanged' {
  if(!existing)return 'create';
  if(!sameJsonValue(existing.config,config))throw Error('Существующая версия ключа неизменяема; создайте новую явную версию с журналом изменений');
  return 'unchanged';
}
