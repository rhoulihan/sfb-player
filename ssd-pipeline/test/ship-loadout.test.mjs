import test from 'node:test';
import assert from 'node:assert/strict';
import { weaponClassOf, shipLoadout } from '../viewer/ship-loadout.js';

test('weaponClassOf maps family/type to a direct-fire class or null', () => {
  assert.equal(weaponClassOf({ family: 'phaser', type: 'Phaser-1' }), 'PH-1');
  assert.equal(weaponClassOf({ family: 'phaser', type: 'Phaser 2K (FX)' }), 'PH-2');
  assert.equal(weaponClassOf({ family: 'phaser', type: 'Phaser-3' }), 'PH-3');
  assert.equal(weaponClassOf({ family: 'heavy-weapon', type: 'Disruptor' }), 'DISR');
  assert.equal(weaponClassOf({ family: 'heavy-weapon', type: 'Photon Torpedo' }), 'PHOTON');
  assert.equal(weaponClassOf({ family: 'drone-rack', type: 'Drone Rack' }), null, 'seeking weapons excluded');
  assert.equal(weaponClassOf({ family: 'shield', type: '' }), null);
});

test('shipLoadout expands weapon groups to one mount per box and reads shields', () => {
  const verified = { groups: [
    { id: 'g1', family: 'phaser', type: 'Phaser-1', arc: 'FH', arcDef: { arcs: ['FH'] }, boxIds: ['b1','b2'] },
    { id: 'g2', family: 'heavy-weapon', type: 'Photon Torpedo', arc: 'FH', arcDef: { arcs: ['FH'] }, boxIds: ['b3'] },
    { id: 's1', family: 'shield', type: 'Shield 1', arcDef: { arcs: [] }, boxIds: new Array(30).fill('x') },
    { id: 'c1', family: 'crew', type: 'Crew', arcDef: { arcs: [] }, boxIds: ['c'] },
  ]};
  const { mounts, shields } = shipLoadout(verified, { boxes: [] });
  assert.equal(mounts.length, 3, '2 phaser mounts + 1 photon mount');
  assert.deepEqual(mounts.map(m => m.cls), ['PH-1','PH-1','PHOTON']);
  assert.equal(mounts[0].id, 'g1.0');
  assert.equal(shields[0], 30, 'shield #1 has 30 boxes');
});
