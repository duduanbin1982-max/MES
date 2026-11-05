"use strict";
// shared/datetime.js
// 2026-11-05（项目排程审计 F-08）：统一数据库里的时间字符串格式。
//
// 约定：
//   · 带时间的字段统一存 'YYYY-MM-DD HH:MM:SS'（空格分隔、无时区后缀、秒级）
//   · 纯日期字段保持 'YYYY-MM-DD'
//   · 入参兼容 'YYYY-MM-DDTHH:mm:ss(.sss)Z'、'YYYY-MM-DD HH:MM'、Date 对象
//
// 背景：此前部分写入点用 new Date().toISOString().slice(0, 19)（带 T、且是 UTC），
// 与其它地方的空格分隔本地时间混用，导致跨模块比较/显示不一致。

function pad(value) {
  return String(value).padStart(2, "0");
}

/** 本地日期 'YYYY-MM-DD'（不要用 toISOString，东八区会变成前一天） */
function formatSqlDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 本地时间 'YYYY-MM-DD HH:MM:SS' */
function formatSqlDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${formatSqlDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 当前本地时间 */
function nowSqlDateTime() {
  return formatSqlDateTime(new Date());
}

/** 当前本地日期 */
function todaySqlDate() {
  return formatSqlDate(new Date());
}

/**
 * 归一化时间字符串到 'YYYY-MM-DD HH:MM:SS'；
 * 纯日期入参保持 'YYYY-MM-DD'；无法识别时原样返回（trim 后）。
 */
function normalizeSqlDateTime(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return formatSqlDateTime(value);
  const raw = String(value).trim();
  if (!raw) return null;
  // 纯日期
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // ISO / 空格分隔 / 带毫秒 / 带 Z
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z?$/);
  if (match) return `${match[1]} ${match[2]}:${match[3]}:${match[4] || "00"}`;
  // 兜底：把 T 换成空格、去掉毫秒和 Z
  return raw.replace("T", " ").replace("Z", "").replace(/\.\d+$/, "").slice(0, 19);
}

module.exports = {
  pad,
  formatSqlDate,
  formatSqlDateTime,
  nowSqlDateTime,
  todaySqlDate,
  normalizeSqlDateTime,
};
