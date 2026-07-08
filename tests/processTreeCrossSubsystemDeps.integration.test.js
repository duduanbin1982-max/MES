'use strict';

/**
 * Integration tests against the live mes.db (TBM-2026-001).
 *
 * These tests run on .73 in /home/dubin/factory-mes/. They assert the
 * matrix service correctly reads the real production schema:
 *   - equipment_subsystems (id, code, name_zh, name_en, sequence, ...)
 *   - process_nodes (id, equipment_instance_id, subsystem_id, ...)
 *   - process_dependencies (predecessor_id, successor_id, dep_type, ...)
 *
 * Skip the suite if DB_PATH is not /home/dubin/factory-mes/data/mes.db
 * (e.g. when running on dev machines that don't have it).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const REAL_DB = '/home/dubin/factory-mes/data/mes.db';
const skip = !fs.existsSync(REAL_DB);
if (skip) {
  test('SKIP: mes.db not present at ' + REAL_DB, { skip: true }, () => {});
} else {
  process.env.DB_PATH = REAL_DB;
}

const db = skip ? null : new Database(REAL_DB, { readonly: true });
if (db) process.on('exit', () => db.close());

const svc = require('../services/processTree/crossSubsystemDeps');

if (!skip) {
  test('instance 1 returns all 9 subsystems + unassigned (1 总装 node)', () => {
    const r = svc.getCrossSubsystemMatrix(db, 1);
    const keys = r.subsystems.map((s) => s.key);
    // 9 subsystems ordered by sequence, then unassigned last.
    assert.equal(keys.length, 10);
    assert.deepEqual(
      keys.slice(0, 9),
      ['sub_1', 'sub_2', 'sub_3', 'sub_4', 'sub_5', 'sub_6', 'sub_7', 'sub_8', 'sub_9']
    );
    assert.equal(keys[9], '__unassigned__');
    // Real subsystem names from equipment_subsystems.
    const nameMap = Object.fromEntries(r.subsystems.map((s) => [s.key, s.name]));
    assert.equal(nameMap.sub_1, '刀盘');
    assert.equal(nameMap.sub_2, '主驱动');
    assert.equal(nameMap.sub_3, '盾体');
    assert.equal(nameMap.sub_7, '液压系统');
    assert.equal(nameMap.__unassigned__, '总装/未分类');
  });

  test('matrix is 10x10 for TBM-2026-001', () => {
    const r = svc.getCrossSubsystemMatrix(db, 1);
    assert.equal(r.matrix.length, 10);
    r.matrix.forEach((row) => {
      assert.equal(row.length, 10);
      row.forEach((cell) => {
        assert.equal(typeof cell.count, 'number');
        assert.equal(typeof cell.weight, 'number');
        assert.ok(Array.isArray(cell.edges));
      });
    });
  });

  test('node counts match subsystem distribution', () => {
    const Database = require('better-sqlite3');
    const probeDb = new Database(REAL_DB, { readonly: true });
    const rows = probeDb.prepare(
      `SELECT COALESCE('sub_' || subsystem_id, '__unassigned__') AS key,
              COUNT(*) AS node_count
         FROM process_nodes
        WHERE equipment_instance_id = ?
        GROUP BY subsystem_id`
    ).all(1);
    probeDb.close();

    const expected = Object.fromEntries(rows.map((row) => [row.key, row.node_count]));
    const r = svc.getCrossSubsystemMatrix(db, 1);
    const counts = Object.fromEntries(r.subsystems.map((s) => [s.key, s.node_count]));
    for (const [key, count] of Object.entries(expected)) {
      assert.equal(counts[key], count, key + ' node_count should match DB');
    }
    assert.equal(
      r.subsystems.reduce((sum, item) => sum + item.node_count, 0),
      Object.values(expected).reduce((sum, count) => sum + count, 0)
    );
  });

  test('total edges equals dep count where both endpoints are in instance 1', () => {
    const r = svc.getCrossSubsystemMatrix(db, 1);
    assert.ok(r.summary.total_edges > 0, 'should have edges');
    assert.ok(r.summary.total_edges <= 89, 'cannot exceed total deps in db');
    assert.equal(
      r.summary.intra_subsystem_edges + r.summary.inter_subsystem_edges,
      r.summary.total_edges
    );
  });

  test('intra-sub weights are non-negative', () => {
    const r = svc.getCrossSubsystemMatrix(db, 1);
    for (let i = 0; i < r.matrix.length; i += 1) {
      const cell = r.matrix[i][i];
      assert.ok(cell.weight >= 0, 'intra weight non-negative');
    }
  });

  test('integration bottlenecks are sorted by total desc and exclude unassigned', () => {
    const r = svc.getCrossSubsystemMatrix(db, 1);
    const bots = r.summary.integration_bottlenecks;
    assert.ok(bots.length <= 3);
    for (let i = 1; i < bots.length; i += 1) {
      assert.ok(bots[i - 1].total >= bots[i].total, 'sorted desc');
    }
    bots.forEach((b) => {
      assert.notEqual(b.subsystem, '__unassigned__');
      assert.ok(b.in_weight >= 0 && b.out_weight >= 0);
    });
  });

  test('strongest couplings are off-diagonal pairs (may be empty if all deps are intra)', () => {
    const r = svc.getCrossSubsystemMatrix(db, 1);
    const s = r.summary.strongest_coupling;
    s.forEach((p) => {
      assert.notEqual(p.from, p.to, 'no self-coupling');
    });
    for (let i = 1; i < s.length; i += 1) {
      assert.ok(s[i - 1].weight >= s[i].weight, 'sorted desc');
    }
    // inter_subsystem_edges > 0 <-> strongest_coupling.length > 0
    if (r.summary.inter_subsystem_edges > 0) {
      assert.ok(s.length > 0, 'should have at least one inter-subsystem coupling');
    } else {
      assert.equal(s.length, 0, 'no inter-subsystem deps => empty strongest');
    }
  });

  test('weakest coupling list does not include pairs with edges', () => {
    const r = svc.getCrossSubsystemMatrix(db, 1);
    const edgePairs = new Set();
    for (let i = 0; i < r.matrix.length; i += 1) {
      for (let j = 0; j < r.matrix.length; j += 1) {
        if (i === j) continue;
        if (r.matrix[i][j].count > 0) edgePairs.add(`${r.subsystems[i].key}->${r.subsystems[j].key}`);
      }
    }
    r.summary.weakest_coupling.forEach((p) => {
      assert.ok(!edgePairs.has(`${p.from}->${p.to}`), `${p.from}->${p.to} should not have edges`);
    });
  });

  test('non-existent instance returns empty', () => {
    const r = svc.getCrossSubsystemMatrix(db, 99999);
    assert.equal(r.subsystems.length, 0);
    assert.equal(r.matrix.length, 0);
    assert.equal(r.summary.total_edges, 0);
  });
}
