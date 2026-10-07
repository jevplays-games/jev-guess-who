import {buildCandidates,fallbackAction,POLICY_VERSION} from '../public/shared/strategy.js';
import {actionId} from '../public/shared/rules.js';
import {boundedText,canonical,sha256} from './security.js';
export const PROMPT_VERSION='choice-1';
export function buildRequest(view,difficulty,model) {
  const {candidates,search}=buildCandidates(view,difficulty);
  const state={rules:'Ask one yes/no trait question OR make one final guess. A wrong final guess immediately loses. Both secrets are independently uniform. Select a legal action to maximize your chance of winning the race. Never infer identity from names.',
    ...view,difficulty};
  const criteria=Object.fromEntries(candidates.map(c=>[c.id,difficulty==='easy'?{question:c.label}:c]));
  const payload={model,state,questions:{action:{type:'choice',instructions:'Select the best action under the rules and supplied computed evidence. Search probabilities are estimates; selection confidence is not a game outcome probability.',criteria}}};
  return {payload,candidates,search};
}
export function validateResponse(data,candidates,model) {
  const answer=data?.answers?.action,keys=candidates.map(c=>c.id).sort();
  // The reason travels on the error as `detail` so a rejected reply is diagnosable from the recorded attempt.
  const fail=detail=>{throw Object.assign(Error('invalid_response'),{detail});};
  if(data?.model!==model||answer?.type!=='choice'||!answer.probabilities||typeof answer.probabilities!=='object')fail('shape_or_model');
  if(JSON.stringify(Object.keys(answer.probabilities).sort())!==JSON.stringify(keys))fail('option_set');
  const probs=Object.values(answer.probabilities);
  if(probs.some(p=>typeof p!=='number'||!Number.isFinite(p)||p<0||p>1))fail('probability_range');
  // Up to 24 options, each typically reported to two or three decimals: rounding alone can move the sum by more than
  // the old 0.001, which rejected honest replies and sent the turn to the fallback. 0.02 still catches a broken distribution.
  if(Math.abs(probs.reduce((a,b)=>a+b,0)-1)>.02)fail('probability_sum');
  if(!Number.isFinite(answer.confidence)||answer.confidence<0||answer.confidence>1)fail('confidence_range');
  const max=Math.max(...probs),tied=keys.filter(id=>answer.probabilities[id]===max);
  if(!tied.includes(answer.choice))fail('choice_not_max');
  return {selected:candidates.find(c=>c.id===tied[0]),probabilities:answer.probabilities,confidence:answer.confidence,
    usage:data.usage&&Number.isInteger(data.usage.input_tokens)&&data.usage.input_tokens>=0&&Number.isInteger(data.usage.output_tokens)&&data.usage.output_tokens>=0?data.usage:null};
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function chooseJevAction(view,config,env,{fetchImpl=fetch}={}) {
  const started=performance.now();
  const {payload,candidates,search}=buildRequest(view,config.difficulty,config.model);
  const buildMs=performance.now()-started,inputHash=await sha256(canonical(payload));
  const base={model:config.model,promptVersion:PROMPT_VERSION,policyVersion:POLICY_VERSION,inputHash,
    candidateCount:candidates.length,candidateEvidence:candidates,search,buildMs,requestBytes:new TextEncoder().encode(JSON.stringify(payload)).length,attempts:[]};
  if(candidates.length===1)return {...base,action:candidates[0].action,actionId:candidates[0].id,source:'forced_rule',selectedFeatures:candidates[0],confidence:null,probabilities:null,latencyMs:performance.now()-started};
  let reason=env.TYPESAFE_API_KEY?'unavailable':'key_not_configured';
  const deadline=performance.now()+Math.min(15000,Math.max(50,Number(env.JEV_TIMEOUT_MS)||3000));
  if(env.TYPESAFE_API_KEY)for(let attempt=0;attempt<2;attempt++) {
    const start=performance.now(),remaining=deadline-start;if(remaining<=0)break;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),remaining);
    let status=null,usage=null,retryDelay=200*2**attempt;
    try {
      const response=await fetchImpl('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${env.TYPESAFE_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
      status=response.status;
      if(!response.ok){
        const ra=response.headers.get('retry-after');
        if(ra){const seconds=Number(ra);retryDelay=Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(ra)-Date.now());}
        throw Error([401,403].includes(status)?'authentication_error':status===422?'request_schema_error':`http_${status}`);
      }
      let data;try{data=JSON.parse(await boundedText(response,65536));}catch{throw Error('invalid_response');}
      if(data.usage&&Number.isInteger(data.usage.input_tokens)&&data.usage.input_tokens>=0&&Number.isInteger(data.usage.output_tokens)&&data.usage.output_tokens>=0)usage=data.usage;
      const checked=validateResponse(data,candidates,config.model);
      base.attempts.push({attempt:attempt+1,status,latencyMs:performance.now()-start,error:null,usage:checked.usage});
      return {...base,action:checked.selected.action,actionId:checked.selected.id,source:'jev',selectedFeatures:checked.selected,
        confidence:checked.confidence,probabilities:checked.probabilities,latencyMs:performance.now()-started};
    }catch(error){
      reason=controller.signal.aborted?'timeout':['invalid_response','authentication_error','request_schema_error'].includes(error.message)||/^http_\d+$/.test(error.message)?error.message:'network_error';
      base.attempts.push({attempt:attempt+1,status,latencyMs:performance.now()-start,error:reason,detail:error.detail??null,usage});
      if(['authentication_error','request_schema_error'].includes(reason))break;
    }finally{clearTimeout(timer);}
    if(attempt===0){if(!Number.isFinite(retryDelay)||performance.now()+retryDelay>=deadline)break;await pause(retryDelay);}
  }
  const action=fallbackAction(view);
  return {...base,action,actionId:actionId(action),source:'fallback',fallbackReason:reason,confidence:null,probabilities:null,latencyMs:performance.now()-started,selectedFeatures:candidates.find(c=>c.id===actionId(action))||null};
}
