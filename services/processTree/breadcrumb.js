"use strict";
// services/processTree/breadcrumb.js
// 仅返回 mindmap 的 breadcrumb 段；调用方必须显式注入 db。

function getBreadcrumb(db, instanceId, partId) {
  const { getMindmap } = require('./mindmap');
  return getMindmap(db, instanceId, partId).breadcrumb;
}

module.exports = { getBreadcrumb };
