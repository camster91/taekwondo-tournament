import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rankPatterns,publicPatterns} from '../src/pattern-routes.mjs';

test('Patterns scores preserve genuine ties and competition ranks without floating point',()=>{
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  const results=rankPatterns(ids,{[ids[0]]:900,[ids[1]]:900,[ids[2]]:875});
  assert.deepEqual(results.map(row=>row.rank),[1,1,3]);
  assert.deepEqual(results.map(row=>row.scoreHundredths),[900,900,875]);
  assert.equal(results.filter(row=>row.rank===1).length,2);
});
test('Patterns rejects missing, foreign, fractional, negative and excessive scores',()=>{
  const id=randomUUID(),other=randomUUID();
  for(const scores of [{},{[other]:900},{[id]:900.5},{[id]:-1},{[id]:1001},{[id]:'900'},{[id]:900,[other]:800}])assert.throws(()=>rankPatterns([id],scores));
  assert.throws(()=>rankPatterns([id,id],{[id]:900}));
  assert.throws(()=>rankPatterns([],{}));
});
test('Patterns supports one entrant and the full 256 entrant bound',()=>{
  const ids=Array.from({length:257},()=>randomUUID()),scores=Object.fromEntries(ids.slice(0,256).map(id=>[id,1000]));
  assert.equal(rankPatterns([ids[0]],{[ids[0]]:0})[0].rank,1);
  const ranked=rankPatterns(ids.slice(0,256),scores);assert.equal(ranked.length,256);assert.ok(ranked.every(row=>row.rank===1));
  assert.throws(()=>rankPatterns(ids,{...scores,[ids[256]]:1000}));
});
test('Public patterns is an explicit alias-only field allowlist',()=>{
  const id=randomUUID(),results=[{competitorId:id,rank:1,scoreHundredths:900,privateName:'Private fixture',club:'Private school',actor:'Private actor'}];
  assert.deepEqual(publicPatterns(results,new Map([[id,'Public alias']])),[{competitor:'Public alias',rank:1,scoreHundredths:900}]);
  assert.equal(publicPatterns(results,new Map())[0].competitor,null);
});
