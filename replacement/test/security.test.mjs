import test from 'node:test';
import assert from 'node:assert/strict';
import {email,eventDate,hashPassword,password,secretMatches,tokenHash,verifyPassword} from '../src/security.mjs';
test('Password hashes are salted and verify only the correct password',async()=>{
  const value='QaFixtureOnly-123456';
  const first=await hashPassword(value),second=await hashPassword(value);
  assert.notEqual(first,second);
  assert.equal(await verifyPassword(value,first),true);
  assert.equal(await verifyPassword('DifferentPassword-123',first),false);
  assert.equal(await verifyPassword(value,'scrypt1:bad:bad'),false);
  assert.throws(()=>password('short'));
  assert.throws(()=>password('a'.repeat(129)));
});
test('Validation rejects impossible dates and normalizes account email',()=>{
  assert.equal(email(' Organizer@Example.invalid '),'organizer@example.invalid');
  assert.throws(()=>email('broken-address'));
  assert.equal(eventDate('2028-02-29'),'2028-02-29');
  for(const value of ['2027-02-29','2026-04-31','not-a-date'])assert.throws(()=>eventDate(value));
});
test('Bootstrap comparison and session hashing fail closed',()=>{
  assert.equal(secretMatches(undefined,'secret'),false);
  assert.equal(secretMatches('other','secret'),false);
  assert.equal(secretMatches('secret','secret'),true);
  assert.match(tokenHash('opaque-token'),/^[a-f0-9]{64}$/);
  assert.notEqual(tokenHash('opaque-token'),tokenHash('other-token'));
});
