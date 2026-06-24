'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// IMPORTANT: this test file expects DB_PATH to point at a DB seeded by
// tests/_seedXsubDb.js (3 subsystems, 8 nodes, 7 deps across 2 instances).
// Run order: node tests/_seedXsubDb.js && DB_PATH=$(...) node tests/processTreeCrossSubsystemDeps.test.js

const svc = require('../services/processTree/crossSubsystemDeps');

test('returns only subsystems with nodes + unassigned if any', () => {
  const r = svc.getCrossSubsystemMatrix(1);
  const keys = r.subsystems.map((s) => s.key);
  assert.deepEqual(
    keys,
    ['sub_1', 'sub_2', 'sub_3', '__unassigned__'],
    'subsystems ordered by sort_order; unassigned last'
  );
});

test('matrix is NxN and every cell has count/weight/edges', () => {
  const r = svc.getCrossSubsystemMatrix(1);
  const n = r.subsystems.length;
  assert.equal(r.matrix.length, n);
  r.matrix.forEach((row) => {
    assert.equal(row.length, n);
    row.forEach((cell) => {
      assert.equal(typeof cell.count, 'number');
      assert.equal(typeof cell.weight, 'number');
      assert.ok(Array.isArray(cell.edges));
    });
  });
});

test('intra-subsystem diagonal accumulates weights correctly', () => {
  const r = svc.getCrossSubsystemMatrix(1);
  // sub1: 3 nodes. Intra: 101->102 (3*3*1.0=9), 102->103 (9) = 18.
  const i = r.subsystems.findIndex((s) => s.key === 'sub_1');
  assert.equal(r.matrix[i][i].count, 2);
  assert.equal(r.matrix[i][i].weight, 18);
});

test('cross-subsystem edges weighted by node counts × type factor', () => {
  const r = svc.getCrossSubsystemMatrix(1);
  // sub1->sub2: 103->201 (FS). 3*2*1.0=6.
  const i1 = r.subsystems.findIndex((s) => s.key === 'sub_1');
  const i2 = r.subsystems.findIndex((s) => s.key === 'sub_2');
  assert.equal(r.matrix[i1][i2].count, 1);
  assert.equal(r.matrix[i1][i2].weight, 6);
  // sub2->sub3: 202->301 (SS). 2*1*0.7=1.4.
  const i3 = r.subsystems.findIndex((s) => s.key === 'sub_3');
  assert.equal(r.matrix[i2][i3].count, 1);
  assert.equal(r.matrix[i2][i3].weight, 1.4);
  // sub3->unassigned: 301->999 (FF). 1*1*0.5=0.5.
  const iu = r.subsystems.findIndex((s) => s.key === '__unassigned__');
  assert.equal(r.matrix[i3][iu].count, 1);
  assert.equal(r.matrix[i3][iu].weight, 0.5);
});

test('edges across instances are excluded', () => {
  const r = svc.getCrossSubsystemMatrix(1);
  let crossedInstance = false;
  for (const row of r.matrix) {
    for (const cell of row) {
      for (const e of cell.edges) {
        if (e.to === 901 || e.from === 901) crossedInstance = true;
      }
    }
  }
  assert.equal(crossedInstance, false);
});

test('summary totals match', () => {
  const r = svc.getCrossSubsystemMatrix(1);
  assert.equal(r.summary.total_edges, 6);
  assert.equal(r.summary.intra_subsystem_edges, 3);
  assert.equal(r.summary.inter_subsystem_edges, 3);
});

test('strongest coupling identifies sub1->sub2', () => {
  const r = svc.getCrossSubsystemMatrix(1);
  assert.equal(r.summary.strongest_coupling[0].from, 'sub_1');
  assert.equal(r.summary.strongest_coupling[0].to, 'sub_2');
  assert.equal(r.summary.strongest_coupling[0].weight, 6);
});

test('integration bottleneck ranks sub2 highest (in=6 out=1.4 total=7.4)', () => {
  const r = svc.getCrossSubsystemMatrix(1);
  assert.equal(r.summary.integration_bottlenecks[0].subsystem, 'sub_2');
  assert.equal(r.summary.integration_bottlenecks[0].total, 7.4);
});

test('empty instance returns empty subsystems + zero summary', () => {
  const r = svc.getCrossSubsystemMatrix(999);
  assert.equal(r.subsystems.length, 0);
  assert.equal(r.matrix.length, 0);
  assert.equal(r.summary.total_edges, 0);
});

test('weakest coupling surfaces disconnected pairs', () => {
  const r = svc.getCrossSubsystemMatrix(1);
  const wcSubs = r.summary.weakest_coupling.map((p) => `${p.from}->${p.to}`);
  // sub1<->sub3 has no edge -> should appear
  assert.ok(wcSubs.includes('sub_1->sub_3'), `expected sub_1->sub_3 in ${JSON.stringify(wcSubs)}`);
});
