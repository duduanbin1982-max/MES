"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assessThreshold,
  fitAutoregression,
  forecast,
  predictNext,
  scoreForecast,
} = require("../services/ai/modelCore");

test("trains autoregression with chronological validation metrics", () => {
  const series = Array.from({ length: 120 }, (_, index) => 50 + (index * 0.25) + Math.sin(index / 4));
  const model = fitAutoregression(series, { minSamples: 48 });
  assert.equal(model.algorithm, "ridge_ar_v1");
  assert.ok(model.training_rows >= 90);
  assert.ok(model.validation_rows >= 20);
  assert.ok(Number.isFinite(model.metrics.mae));
  assert.ok(Number.isFinite(model.metrics.rmse));
  assert.ok(model.metrics.r2 > 0.8);
});

test("predicts next point and recursive horizon", () => {
  const series = Array.from({ length: 100 }, (_, index) => 20 + (index * 0.1));
  const model = fitAutoregression(series);
  const next = predictNext(model.parameters, series);
  const future = forecast(model.parameters, series, 12);
  assert.ok(next > series.at(-1));
  assert.equal(future.length, 12);
  assert.ok(future.every(Number.isFinite));
});

test("falls back to learned threshold when configured high alarm is invalid", () => {
  const series = Array.from({ length: 80 }, (_, index) => 80 + Math.sin(index));
  const model = fitAutoregression(series);
  const thresholds = assessThreshold(model.parameters, 0, 6);
  assert.equal(thresholds.calibration_status, "warning");
  assert.equal(thresholds.configured_high_valid, false);
  assert.ok(thresholds.high > 80);
});

test("scores a rising forecast as finite risk", () => {
  const series = Array.from({ length: 120 }, (_, index) => 40 + (index * 0.2));
  const model = fitAutoregression(series);
  const thresholds = assessThreshold(model.parameters, 0, 70);
  const result = scoreForecast(model.parameters, series, thresholds, 24);
  assert.ok(result.risk >= 0 && result.risk <= 100);
  assert.equal(result.predictions.length, 24);
  assert.ok(Number.isFinite(result.next_prediction));
});

test("does not compare current reading against future prediction for residual risk", () => {
  const series = Array.from({ length: 120 }, (_, index) => 60 + (index * 0.01) + (Math.sin(index) * 0.02));
  const model = fitAutoregression(series);
  const thresholds = assessThreshold(model.parameters, 0, 95);
  const result = scoreForecast(model.parameters, series, thresholds, 24);
  assert.ok(Math.abs(result.expected_current - series.at(-1)) < 0.2);
  assert.ok(result.risk < 70);
});

test("rejects insufficient training samples", () => {
  assert.throws(() => fitAutoregression([1, 2, 3]), /at least 48 samples/);
});
