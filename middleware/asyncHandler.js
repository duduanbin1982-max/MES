/**  middleware/asyncHandler.js  P0-3: 转发错误到 errorHandler 统一处理  Author: brooks-sweep | Date: 2026-06-26 */
'use strict';
function wrap(fn) {
  return (req, res, next) => {
    try {
      return Promise.resolve(fn(req, res, next)).catch((err) => {
        if (typeof next === 'function') return next(err);
        throw err;
      });
    } catch (err) {
      if (typeof next === 'function') return next(err);
      throw err;
    }
  };
}
module.exports = { wrap };
