// services/processTree/mindmap/views.js
// 4 个 Mindmap 视图函数，统一在文件末尾导出。
//   getRootView / getSubsystemView / getPartView / getNodeView
'use strict';

const { pickPartName, deriveStatus, statusFromChildren, ROOT_ID } = require('../_pure');

const { getRootView } = require("./rootView");
const { aggregatePartsByBomId, getSubsystemView } = require("./subsystemView");
const { getPartView } = require("./partView");
const { getNodeView } = require("./nodeView");

// ============================================================
// getRootView
// ============================================================
module.exports = { getRootView, getSubsystemView, getPartView, getNodeView };
