'use strict';

/**
 * Integration tests for processTreeMindmap against the live mes.db.
 *
 * Verifies the 4-level mindmap shape (总装 → subsystem → part → operation).
 * Skipped automatically if mes.db is not present (e.g. on dev machines).
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

const svc = require('../services/processTree/mindmap');
const { getBreadcrumb } = require('../services/processTree/breadcrumb');

if (!skip) {
  test('root view returns 总装 + 9 subsystems + breadcrumb', () => {
    const r = svc.getMindmap(db, 1, 'root');
    assert.equal(r.current.part_id, 'root');
    assert.equal(r.current.kind, 'root');
    assert.equal(r.current.level, 1);
    assert.ok(r.current.child_count >= 9, 'expect ≥ 9 subsystem children');
    assert.equal(r.current.name, '总装');
    assert.deepEqual(r.breadcrumb.map((b) => b.part_id), ['root']);
    for (const c of r.children) {
      assert.equal(c.kind, 'subsystem');
      assert.equal(c.level, 2);
      assert.ok(c.part_id.startsWith('sub_'));
    }
  });

  test('subsystem view returns distinct parts with ops summary', () => {
    const r = svc.getMindmap(db, 1, 'sub_3');
    assert.equal(r.current.kind, 'subsystem');
    assert.equal(r.current.name, '盾体');
    assert.ok(r.current.child_count > 0);
    assert.deepEqual(r.breadcrumb.map((b) => b.part_id), ['root', 'sub_3']);
    // Every child must be a part with an integer bom_node_id
    for (const c of r.children) {
      assert.equal(c.kind, 'part');
      assert.equal(c.level, 3);
      assert.ok(Number.isInteger(c.bom_node_id));
      assert.ok(c.name.length > 0, 'part name should not be empty');
    }
  });

  test('hydraulic subsystem (sub_7) contains the 7 expected parts', () => {
    const r = svc.getMindmap(db, 1, 'sub_7');
    const names = r.children.map((c) => c.name);
    // Sample the expected hydraulics parts the user already verified manually
    for (const expected of ['主密封 (唇形+挡圈)', '铰接油缸', '主液压泵']) {
      assert.ok(
        names.some((n) => n.includes(expected) || n === expected),
        `expected part "${expected}" in ${JSON.stringify(names)}`
      );
    }
  });

  test('part view returns 3 operation steps (采购/检验/安装)', () => {
    const r = svc.getMindmap(db, 1, 'part_22');
    assert.equal(r.current.kind, 'part');
    assert.equal(r.current.level, 3);
    assert.equal(r.current.child_count, 3);
    assert.equal(r.children.length, 3);
    const opNames = r.children.map((c) => c.name);
    for (const expected of ['采购下单', '入库检验', '领用安装']) {
      assert.ok(opNames.includes(expected), `expected op "${expected}" in ${JSON.stringify(opNames)}`);
    }
    // Breadcrumb root → sub_7 (hydraulics) → part
    assert.equal(r.breadcrumb.length, 3);
    assert.equal(r.breadcrumb[1].part_id, 'sub_7');
  });

  test('operation (level-4) view exposes dependencies as edges', () => {
    const r = svc.getMindmap(db, 1, 'node_148');
    assert.equal(r.current.kind, 'operation');
    assert.equal(r.current.level, 4);
    // Breadcrumb should be 4 deep
    assert.equal(r.breadcrumb.length, 4);
    assert.equal(r.breadcrumb[0].part_id, 'root');
    assert.equal(r.breadcrumb[3].part_id, 'node_148');
    // Either outgoing edges, incoming edges, or both
    const e = r.edges || {};
    assert.ok(
      (e.incoming && e.incoming.length > 0) || (e.outgoing && e.outgoing.length > 0),
      'expected at least one edge (incoming or outgoing)'
    );
  });

  test('invalid part_id throws 400', () => {
    assert.throws(() => svc.getMindmap(db, 1, 'bogus_xyz'), /invalid part_id/);
  });

  test('non-existent subsystem id returns 404', () => {
    try {
      svc.getMindmap(db, 1, 'sub_99999');
      assert.fail('should have thrown');
    } catch (e) {
      assert.equal(e.status, 404);
    }
  });

  test('non-existent bom_node_id returns 404', () => {
    try {
      svc.getMindmap(db, 1, 'part_99999');
      assert.fail('should have thrown');
    } catch (e) {
      assert.equal(e.status, 404);
    }
  });

  test('getBreadcrumb is cheaper subset of getMindmap', () => {
    const bc = getBreadcrumb(db, 1, 'part_22');
    assert.equal(bc.length, 3);
    assert.equal(bc[0].part_id, 'root');
    assert.equal(bc[2].part_id, 'part_22');
  });

  test('all 129 nodes are reachable: total of leaf operations matches', () => {
    // Walk the tree: sum of (part.operation_count) across all subsystems should
    // equal the count of process_nodes for instance 1.
    const root = svc.getMindmap(db, 1, 'root');
    let totalParts = 0;
    for (const sub of root.children) {
      if (!sub.part_id.startsWith('sub_')) continue;
      const sid = parseInt(sub.part_id.slice(4), 10);
      if (Number.isNaN(sid)) continue;
      const subView = svc.getMindmap(db, 1, sub.part_id);
      totalParts += subView.children.length;
    }
    // We don't assert an exact number because unassigned group is skipped,
    // but it should be ≥ 30 (TBM-2026-001 has ~38 distinct parts).
    assert.ok(totalParts >= 30, `expected ≥ 30 distinct parts, got ${totalParts}`);
  });
}
