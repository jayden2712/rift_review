// Synthetic Match-V5 shape, not a response verified against a live Riot key.
export function timelineFixture() {
 const point=(timestamp,cs=0,gold=0)=>({timestamp,participantFrames:{'7':{participantId:7,minionsKilled:cs,jungleMinionsKilled:0,totalGold:gold,currentGold:0,xp:0,level:1}},events:[]});
 return {metadata:{matchId:'OC1_99',participants:['other','player']},info:{frameInterval:60000,participants:[{participantId:2,puuid:'other'},{participantId:7,puuid:'player'}],frames:[point(0),point(570000,60,4000),{...point(600001,66,4100),events:[{type:'CHAMPION_KILL',timestamp:600001,killerId:2,victimId:7,assistingParticipantIds:[]},{type:'ITEM_PURCHASED',timestamp:600001,participantId:7,itemId:1001}]},point(900000,90,6000),point(1200000,120,8000)],gameId:99}};
}
export function matchFixture(){return {metadata:{matchId:'OC1_99'},info:{mapId:11,queueId:420,gameDuration:1230,participants:[{participantId:7,puuid:'player',championName:'Ahri',teamPosition:'MIDDLE',teamId:100,win:true,kills:1,deaths:1,assists:1},{participantId:2,puuid:'other',championName:'Jinx',teamPosition:'BOTTOM',teamId:200}]}};}
