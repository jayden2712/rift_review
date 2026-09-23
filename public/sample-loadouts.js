import {t} from './i18n.js';
// Fictional loadouts for the explicitly labelled sample history only.
export function sampleMatchDetail(match){
  const support=match.role==='Support',adc=match.role==='ADC';
  const items=support?[3877,3117,3190,3109,3050,0,3364]:adc?[3031,3006,3085,3036,3072,3094,3363]:[3020,6655,3089,3135,3157,4645,3363];
  const runes=adc?{primaryStyle:8000,secondaryStyle:8200,primary:[8005,8009,9104,8014],secondary:[8275,8234],shards:[5005,5008,5001]}
    :support?{primaryStyle:8400,secondaryStyle:8300,primary:[8439,8463,8473,8242],secondary:[8306,8347],shards:[5007,5001,5001]}
    :{primaryStyle:8100,secondaryStyle:8200,primary:[8112,8126,8140,8106],secondary:[8226,8210],shards:[5005,5008,5001]};
  const names=['Garen','Lee Sin',match.champion,'Jinx','Leona','Darius','Viego','Lux','Caitlyn','Nautilus'];
  const participants=names.map((champion,i)=>({champion,riotId:i===2?t('Bạn')+'#DEMO':t('Mẫu {number}',{number:i+1})+'#DEMO',role:i===2?match.role:['Top','Jungle','Mid','ADC','Support'][i%5],teamId:i<5?100:200,isPlayer:i===2,
    championLevel:i===2?16:15,summonerSpells:[4,i===1||i===6?11:i===2?14:12],items:i===2?items:[1055,1001,0,0,0,0,3340],
    runes:i===2?runes:null,kills:i===2?match.kills:4,deaths:i===2?match.deaths:5,assists:i===2?match.assists:8,cs:i===2?match.cs:170,damageToChampions:18000,goldEarned:11500,visionScore:20}));
  return {sample:true,gameVersion:t('Dữ liệu mẫu'),durationSeconds:Math.round(match.durationMinutes*60),participants,
    lobbyRank:{status:'available',label:'GOLD II',tier:'GOLD',division:'II',rankedCount:10,totalPlayers:10,basis:'sample'}};
}
