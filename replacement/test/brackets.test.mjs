import test from 'node:test';
import assert from 'node:assert/strict';
import {bracketChampion,createBracket,scoreBracket} from '../src/brackets.mjs';
test('Three entrants get one bye and cannot score a waiting final',()=>{
  let bracket=createBracket(['seed1','seed2','seed3']);
  assert.equal(bracket[0].status,'bye');assert.equal(bracket[0].winner,'seed1');
  assert.equal(bracket[1].status,'ready');assert.equal(bracket[2].status,'waiting');
  assert.throws(()=>scoreBracket(bracket,'2:1',1,0),/MATCH_NOT_READY/);
  bracket=scoreBracket(bracket,'1:2',0,2);
  assert.equal(bracket[2].left,'seed1');assert.equal(bracket[2].right,'seed3');
  assert.equal(bracket[2].status,'ready');
  bracket=scoreBracket(bracket,'2:1',3,1);assert.equal(bracketChampion(bracket),'seed1');
  assert.throws(()=>scoreBracket(bracket,'2:1',0,3),/MATCH_NOT_READY/);
});
test('All supported bracket sizes resolve without duplicate entrants or extra played matches',()=>{
  for(let size=2;size<=256;size++){
    const entrants=Array.from({length:size},(_,index)=>`entrant${index+1}`);
    let bracket=createBracket(entrants),played=0;
    const first=bracket.filter(match=>match.round===1).flatMap(match=>[match.left,match.right]).filter(Boolean);
    assert.deepEqual([...first].sort(),[...entrants].sort());
    while(!bracketChampion(bracket)){
      const next=bracket.find(match=>match.status==='ready');assert.ok(next,'Bracket deadlocked');
      bracket=scoreBracket(bracket,next.key,1,0);played++;
    }
    assert.equal(played,size-1);
    assert.equal(bracketChampion(bracket),'entrant1');
  }
});
test('Scores and entrants reject invalid inputs without mutating prior results',()=>{
  for(const entrants of [[],['a'],['a','a'],Array(257).fill('a')])assert.throws(()=>createBracket(entrants));
  const bracket=createBracket(['a','b']);
  for(const [left,right] of [[1,1],[-1,0],[0.5,1],[1000,1],['2',1]])assert.throws(()=>scoreBracket(bracket,'1:1',left,right),/INVALID_SCORE/);
  assert.equal(bracket[0].status,'ready');assert.equal(bracket[0].winner,null);
});
