"use strict";
// app/oee/lossCatalog.js
// OEE 损失目录的加载与归一化（2026-10-18 P0-1：ISA-95 口径固化）
//
// 为什么需要它：
//   历史数据里 loss_category 是自由中文（故障停机/待料/降速…），同一类损失可能有 5 种写法，
//   导致"六大损失"报表口径不稳定。现在统一为 catalog 里的 category_key，
//   中文旧值通过 legacy_labels 自动归一（写库时也会归一），报表只按 key 聚合。

const catalog = require("../../shared/oeeLossCatalog.json");

const BY_KEY = new Map(catalog.categories.map((c) => [c.key, c]));
const BY_LEGACY = new Map();
for (const c of catalog.categories) {
  for (const label of c.legacy_labels || []) BY_LEGACY.set(String(label).trim().toLowerCase(), c.key);
  BY_LEGACY.set(String(c.label).trim().toLowerCase(), c.key);
  BY_LEGACY.set(c.key, c.key);
}

const OTHER_KEY = "other";

/** 任意输入（key / 中文标签 / 未知文本）→ 规范 category_key */
function normalizeKey(raw) {
  if (!raw) return OTHER_KEY;
  const text = String(raw).trim().toLowerCase();
  if (BY_KEY.has(text)) return text;
  if (BY_LEGACY.has(text)) return BY_LEGACY.get(text);
  // 包含匹配：如 "设备故障（液压）" → equipment_failure
  for (const c of catalog.categories) {
    for (const label of c.legacy_labels || []) {
      if (label && text.includes(String(label).toLowerCase())) return c.key;
    }
  }
  return OTHER_KEY;
}

function categoryOf(key) {
  return BY_KEY.get(key) || BY_KEY.get(OTHER_KEY);
}

function labelOf(key) {
  return categoryOf(key).label;
}

function countsAsLoss(key) {
  return categoryOf(key).countsAsLoss !== false;
}

function bucketOf(key) {
  return categoryOf(key).bucket || "availability";
}

/** 按 bucket / 按 key 汇总损失分钟数 */
function summarize(rows) {
  const byKey = new Map();
  const byBucket = { availability: 0, performance: 0, quality: 0, none: 0 };
  for (const row of rows || []) {
    const key = normalizeKey(row.category_key || row.loss_category);
    const minutes = Number(row.minutes || row.duration_minutes || 0) || 0;
    byKey.set(key, (byKey.get(key) || 0) + minutes);
    byBucket[bucketOf(key)] += minutes;
  }
  const losses = [...byKey.entries()]
    .map(([key, minutes]) => ({
      key,
      label: labelOf(key),
      bucket: bucketOf(key),
      minutes: Math.round(minutes * 100) / 100,
      counts_as_loss: countsAsLoss(key),
    }))
    .sort((a, b) => b.minutes - a.minutes);
  return { byKey: losses, byBucket };
}

module.exports = { catalog, normalizeKey, categoryOf, labelOf, countsAsLoss, bucketOf, summarize, OTHER_KEY };
