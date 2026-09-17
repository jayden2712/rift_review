// Transparent practice heuristics, not Riot statistics or rank/patch benchmarks.
export const RULES = Object.freeze({version:'1.0',csReview:{Top:6,Jungle:5,Mid:6,ADC:6.5},csStrength:{Top:7,Jungle:6,Mid:7,ADC:7.5},visionReview:0.5,supportVisionReview:1.2,visionStrength:0.9,supportVisionStrength:1.8,kpReview:0.4,kpStrength:0.6,deathsReview:7,deathsStrength:4});
const fixed=n=>n.toFixed(1);
export function generateReport(m) {
 const metrics={kda:m.deaths===0?null:(m.kills+m.assists)/m.deaths,csPerMin:m.cs===null?null:m.cs/m.durationMinutes,visionPerMin:m.visionScore===null?null:m.visionScore/m.durationMinutes,participation:m.teamKills?((m.kills+m.assists)/m.teamKills):null,deathsPer30:m.deaths*30/m.durationMinutes};
 const strengths=[],mistakes=[];
 const add=(id,title,evidence,interpretation,action,target,weight)=>mistakes.push({id,title,evidence,interpretation,action,target,weight});
 if(metrics.deathsPer30>=RULES.deathsReview) add('survival','Stay available for the next play',`${m.deaths} deaths in ${m.durationMinutes} minutes · ${fixed(metrics.deathsPer30)} per 30 min.`,`This crosses the demo review threshold of ${RULES.deathsReview} deaths per 30 minutes. Death causes need replay review.`, m.role==='Support'?'Review your last three deaths. Check whether each engage gave your team a useful trade, and identify an exit before committing.':'Review your last three deaths. Before the next fight, identify an exit and check which opponents are visible.', 'Tag three deaths as avoidable, a useful trade, or unclear. Pick one repeated cause to work on.',100);
 else if(metrics.deathsPer30<=RULES.deathsStrength) strengths.push({title:'Low death count',evidence:`${m.deaths} deaths · ${fixed(metrics.deathsPer30)} per 30 min.`,detail:'A positive survival signal. Check that you also stayed involved; a low death count alone does not prove good positioning.'});
 if(m.role!=='Support' && metrics.csPerMin!==null) {
  const target=RULES.csReview[m.role];
  if(metrics.csPerMin<target) add('farm','Protect your farming windows',`${m.cs} CS in ${m.durationMinutes} minutes · ${fixed(metrics.csPerMin)} CS/min.`,`Below this demo's ${target.toFixed(1)} CS/min practice target for ${m.role}. Matchups and game state can change what is realistic.`,m.role==='Jungle'?'Review time spent walking or waiting between camps and plays. Plan one nearby camp before each rotation, when safe.':'Before roaming or recalling, check the wave. Collect the next safe wave instead of waiting for an uncertain fight.',`Aim for ${fixed(Math.min(metrics.csPerMin+0.5,target))} CS/min next match; record whether you met it.`,80);
  else if(metrics.csPerMin>=RULES.csStrength[m.role]) strengths.push({title:'Steady farm income',evidence:`${fixed(metrics.csPerMin)} CS/min · ${m.cs} total CS.`,detail:`Above the demo's ${RULES.csStrength[m.role].toFixed(1)} CS/min strength threshold for ${m.role}. Keep collecting safe farm between plays.`});
 }
 const visionLow=m.role==='Support'?RULES.supportVisionReview:RULES.visionReview;
 const visionHigh=m.role==='Support'?RULES.supportVisionStrength:RULES.visionStrength;
 if(metrics.visionPerMin!==null) {
  if(metrics.visionPerMin<visionLow) add('vision','Make vision part of your setup',`${m.visionScore} vision score · ${fixed(metrics.visionPerMin)} per minute.`,`Below the demo's ${visionLow.toFixed(1)} score/min review threshold for ${m.role}. The score cannot show whether a ward was well placed.`, 'Before a planned objective, check your trinket and move with a teammate to place or clear vision. Avoid entering fog alone just to raise a score.', 'Review vision setup before two objectives. Record whether your team had a safe, visible route.',60);
  else if(metrics.visionPerMin>=visionHigh) strengths.push({title:'Active vision contribution',evidence:`${m.visionScore} vision score · ${fixed(metrics.visionPerMin)} per minute.`,detail:'Above the demo strength threshold. Review ward timing and placement to see how much of that vision helped your team.'});
 }
 if(metrics.participation!==null) {
  if(metrics.participation<RULES.kpReview) add('involvement','Connect your next move to the team',`${Math.round(metrics.participation*100)}% kill participation · ${m.kills+m.assists} of ${m.teamKills} team kills.`, 'Low participation is a review signal, not proof of poor teamwork; split pushing and cross-map trades can be valuable.', 'Review two fights you missed. Decide whether joining or trading elsewhere had more value, and ping your intention before committing.', 'For two major team plays, note your intended contribution: join, pressure a lane, or take another objective.',70);
  else if(metrics.participation>=RULES.kpStrength) strengths.push({title:'You are part of the action',evidence:`${Math.round(metrics.participation*100)}% kill participation · ${m.kills+m.assists} of ${m.teamKills} team kills.`,detail:'A positive involvement signal. Preserve that contribution while checking whether each fight is worth taking.'});
 }
 mistakes.sort((a,b)=>b.weight-a.weight);
 const priorities=mistakes.slice(0,3).map((x,i)=>({...x,rank:i+1}));
 if(!priorities.length) priorities.push({id:'consistency',rank:1,title:'Turn a good signal into a repeatable habit',action:'Review one fight and one rotation. Write down the information that made the decision useful, then repeat that check next game.',target:'Record one decision to repeat and one decision to investigate.',evidence:'No supplied metric crosses the demo review thresholds.'});
 const missing=['cs','visionScore','teamKills'].filter(k=>m[k]===null);
 const limitations=['One match is a snapshot, not a trend.','No replay or timeline: positioning, mechanics, objective timing, and death causes cannot be confirmed.','Targets are illustrative coaching rules, not rank, patch, or champion benchmarks.'];
 if(missing.length) limitations.push(`Missing optional data: ${missing.map(x=>({cs:'CS',visionScore:'vision score',teamKills:'team kills'}[x])).join(', ')}. Related checks are skipped.`);
 if(m.teamKills===0) limitations.push('Kill participation is unavailable because team kills is zero.');
 const summary=mistakes.length?`${strengths.length?'There are useful signals to build on.':'Start with one measurable habit.'} Your first focus: ${priorities[0].title.toLowerCase()}.`:'The supplied stats show no major flags under these demo rules. Use replay review to find a more specific next step.';
 return {engine:'Transparent rules · v'+RULES.version,match:m,metrics,strengths,mistakes,priorities,limitations,summary};
}
export const ruleBasedCoach={id:'rules-v1',async analyze(match){return generateReport(match);}};
export function reportToMarkdown(r) {
 const m=r.match;
 return [`# Rift Review — ${m.champion} / ${m.role}`,`${m.result} · ${m.durationMinutes} min · ${m.kills}/${m.deaths}/${m.assists}`,`Engine: ${r.engine} (demo, not a live AI model)`,r.summary,'## Strengths',...(r.strengths.length?r.strengths.map(x=>`- ${x.title}: ${x.evidence} ${x.detail}`):['No clear strength identified from the supplied metrics.']),'## Mistakes to investigate',...(r.mistakes.length?r.mistakes.map(x=>`- ${x.title}: ${x.evidence} ${x.interpretation}`):['No supplied metric crosses a demo review threshold. This does not establish mistake-free play.']),'## Priorities & recommendations',...r.priorities.map(x=>`${x.rank}. ${x.title}\n   ${x.action}\n   Check: ${x.target}`),...(m.notes?['## Your reflection (not analyzed)',m.notes]:[]),'## Limits',...r.limitations.map(x=>'- '+x)].join('\n\n');
}
