"use strict";
// services/processTree/crossSubsystemDeps/constants.js
// 跨子系统依赖矩阵: 共享常量 + 工具
// Author: 三狗子 | Date: 2026-06-24

// 不同依赖类型的权重系数 (FS=1.0 强, SS=0.7, FF/SF=0.5 弱)
// 注: 这是耦合强度近似, FS (完成-开始) 是工程上最强的依赖, 决定串行性
const TYPE_FACTOR = {
  FS: 1.0,  // Finish-to-Start: 完成-开始
  SS: 0.7,  // Start-to-Start: 同时开始
  FF: 0.5,  // Finish-to-Finish: 同时完成
  SF: 0.5,  // Start-to-Finish: 开始-完成 (少用)
};

// 虚拟 subsystem id: 表示 "未分配到任何 subsystem 的节点"
const UNASSIGNED = "__unassigned__";

// Stable colour palette — 按 subsystem id 散列取色, 保证 UI 跨视图一致
const PALETTE = [
  "#0ea5e9", "#22c55e", "#f97316", "#a855f7", "#ef4444",
  "#14b8a6", "#eab308", "#ec4899", "#6366f1", "#10b981",
];

// 根据 id 取色 (稳定散列)
function colorForId(id) {
  if (id == null) return "#94a3b8";
  return PALETTE[Math.abs(Number(id)) % PALETTE.length];
}

// 数字保留 2 位
function round2(n) { return Math.round(n * 100) / 100; }

module.exports = {
  TYPE_FACTOR,
  UNASSIGNED,
  PALETTE,
  colorForId,
  round2,
};
