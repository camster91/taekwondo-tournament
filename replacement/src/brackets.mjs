const finished=match=>['completed','bye'].includes(match.status);
function refresh(matches){
  const byKey=new Map(matches.map(match=>[match.key,match]));
  for(const match of matches){
    let resolved=true;
    if(match.leftSource){
      const left=byKey.get(match.leftSource),right=byKey.get(match.rightSource);
      if(!left||!right)throw new Error('Invalid bracket source');
      resolved=finished(left)&&finished(right);
      match.left=finished(left)?left.winner:null;
      match.right=finished(right)?right.winner:null;
    }
    if(match.status==='completed'){
      if(!resolved||![match.left,match.right].includes(match.winner)||!match.winner)throw new Error('Invalid completed match');
      continue;
    }
    if(!resolved){match.status='waiting';match.winner=null;}
    else if(!match.left||!match.right){match.status='bye';match.winner=match.left||match.right;}
    else{match.status='ready';match.winner=null;}
  }
  return matches;
}
export function createBracket(entrants){
  if(!Array.isArray(entrants)||entrants.length<2||entrants.length>256||entrants.some(id=>typeof id!=='string'||!id)||new Set(entrants).size!==entrants.length)throw new Error('Invalid bracket entrants');
  let positions=[1,2];
  while(positions.length<entrants.length){const size=positions.length*2;positions=positions.flatMap(seed=>[seed,size+1-seed]);}
  const matches=[];
  let count=positions.length/2,round=1;
  while(count>=1){
    for(let index=0;index<count;index++){
      const first=round===1;
      matches.push({key:`${round}:${index+1}`,round,index:index+1,left:first?(entrants[positions[index*2]-1]||null):null,right:first?(entrants[positions[index*2+1]-1]||null):null,leftSource:first?null:`${round-1}:${index*2+1}`,rightSource:first?null:`${round-1}:${index*2+2}`,status:'waiting',winner:null,scoreLeft:null,scoreRight:null});
    }
    round++;count/=2;
  }
  return refresh(matches);
}
export function scoreBracket(input,key,scoreLeft,scoreRight){
  const matches=structuredClone(input),match=matches.find(item=>item.key===key);
  if(!match||match.status!=='ready')throw new Error('MATCH_NOT_READY');
  if(![scoreLeft,scoreRight].every(value=>Number.isInteger(value)&&value>=0&&value<=999)||scoreLeft===scoreRight)throw new Error('INVALID_SCORE');
  match.scoreLeft=scoreLeft;match.scoreRight=scoreRight;
  match.winner=scoreLeft>scoreRight?match.left:match.right;match.status='completed';
  return refresh(matches);
}
export function bracketChampion(matches){const final=matches.at(-1);return final&&finished(final)?final.winner:null;}
