"use strict";

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    if (Math.abs(divisor) < 1e-12) throw new Error("Training matrix is singular");

    for (let item = column; item <= size; item += 1) augmented[column][item] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let item = column; item <= size; item += 1) {
        augmented[row][item] -= factor * augmented[column][item];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

function featureVector(history, index, stats) {
  const normalize = (value) => (value - stats.mean) / stats.stddev;
  const recent = history.slice(index - 5, index);
  return [
    1,
    normalize(history[index - 1]),
    normalize(history[index - 2]),
    normalize(mean(recent)),
    index / Math.max(stats.seriesLength - 1, 1),
  ];
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + (value * right[index]), 0);
}

function calculateMetrics(actual, predicted, baseline) {
  const errors = actual.map((value, index) => value - predicted[index]);
  const mae = mean(errors.map(Math.abs));
  const rmse = Math.sqrt(mean(errors.map((value) => value ** 2)));
  const actualMean = mean(actual);
  const totalVariance = actual.reduce((sum, value) => sum + ((value - actualMean) ** 2), 0);
  const residualVariance = errors.reduce((sum, value) => sum + (value ** 2), 0);
  const r2 = totalVariance > 0 ? 1 - (residualVariance / totalVariance) : 0;
  const baselineMae = mean(actual.map((value, index) => Math.abs(value - baseline[index])));
  const skillVsBaseline = baselineMae > 0 ? 1 - (mae / baselineMae) : 0;
  return { mae, rmse, r2, baseline_mae: baselineMae, skill_vs_baseline: skillVsBaseline };
}

function fitAutoregression(series, options = {}) {
  const values = series.map(Number).filter(Number.isFinite);
  const minSamples = options.minSamples || 48;
  if (values.length < minSamples) throw new Error(`Need at least ${minSamples} samples`);

  const splitIndex = Math.max(12, Math.floor(values.length * (options.trainRatio || 0.8)));
  const trainSeries = values.slice(0, splitIndex);
  const average = mean(trainSeries);
  const deviation = stddev(trainSeries) || 1;
  const stats = { mean: average, stddev: deviation, seriesLength: values.length };
  const rows = [];
  const targets = [];

  for (let index = 5; index < splitIndex; index += 1) {
    rows.push(featureVector(values, index, stats));
    targets.push((values[index] - average) / deviation);
  }

  const featureCount = rows[0].length;
  const matrix = Array.from({ length: featureCount }, () => Array(featureCount).fill(0));
  const vector = Array(featureCount).fill(0);
  const ridge = options.ridge || 0.01;

  for (let row = 0; row < rows.length; row += 1) {
    for (let left = 0; left < featureCount; left += 1) {
      vector[left] += rows[row][left] * targets[row];
      for (let right = 0; right < featureCount; right += 1) {
        matrix[left][right] += rows[row][left] * rows[row][right];
      }
    }
  }
  for (let index = 1; index < featureCount; index += 1) matrix[index][index] += ridge;
  const weights = solveLinearSystem(matrix, vector);

  const predictAt = (history, index) => average + (dot(weights, featureVector(history, index, stats)) * deviation);
  const trainPredictions = [];
  const trainActual = [];
  for (let index = 5; index < splitIndex; index += 1) {
    trainPredictions.push(predictAt(values, index));
    trainActual.push(values[index]);
  }
  const residualStddev = stddev(trainActual.map((value, index) => value - trainPredictions[index])) || deviation;

  const actual = [];
  const predicted = [];
  const baseline = [];
  for (let index = splitIndex; index < values.length; index += 1) {
    actual.push(values[index]);
    predicted.push(predictAt(values, index));
    baseline.push(values[index - 1]);
  }
  const metrics = calculateMetrics(actual, predicted, baseline);

  return {
    algorithm: "ridge_ar_v1",
    parameters: {
      weights,
      mean: average,
      stddev: deviation,
      residual_stddev: residualStddev,
      lag: 5,
      series_length: values.length,
    },
    metrics,
    training_rows: splitIndex,
    validation_rows: values.length - splitIndex,
    feature_schema: ["intercept", "lag_1", "lag_2", "rolling_mean_5", "time_index"],
  };
}

function predictNext(parameters, history) {
  if (!Array.isArray(history) || history.length < parameters.lag) throw new Error("Insufficient prediction history");
  const stats = {
    mean: parameters.mean,
    stddev: parameters.stddev || 1,
    seriesLength: Math.max(parameters.series_length, history.length + 1),
  };
  return parameters.mean + (dot(parameters.weights, featureVector(history, history.length, stats)) * stats.stddev);
}

function forecast(parameters, history, steps = 24) {
  const values = history.map(Number).filter(Number.isFinite);
  const predictions = [];
  for (let index = 0; index < steps; index += 1) {
    const next = predictNext(parameters, values);
    values.push(next);
    predictions.push(next);
  }
  return predictions;
}

function assessThreshold(parameters, alarmLow, alarmHigh) {
  const lowerLearned = parameters.mean - (3 * parameters.stddev);
  const upperLearned = parameters.mean + (3 * parameters.stddev);
  const highValid = Number.isFinite(alarmHigh) && alarmHigh > parameters.mean - parameters.stddev;
  const lowValid = Number.isFinite(alarmLow) && alarmLow < parameters.mean + parameters.stddev;
  return {
    low: lowValid ? alarmLow : lowerLearned,
    high: highValid ? alarmHigh : upperLearned,
    calibration_status: highValid && lowValid ? "ok" : "warning",
    configured_low_valid: lowValid,
    configured_high_valid: highValid,
  };
}

function scoreForecast(parameters, history, thresholds, steps = 24) {
  const predictions = forecast(parameters, history, steps);
  const scale = Math.max(parameters.stddev, parameters.residual_stddev, 1e-6);
  const highDistance = (Math.max(...predictions) - thresholds.high) / scale;
  const lowDistance = (thresholds.low - Math.min(...predictions)) / scale;
  const thresholdDistance = Math.max(highDistance, lowDistance);
  const thresholdRisk = 100 / (1 + Math.exp(-2 * thresholdDistance));
  const nextPrediction = predictions[0];
  const previousHistory = history.slice(0, -1);
  const expectedCurrent = previousHistory.length >= parameters.lag
    ? predictNext(parameters, previousHistory)
    : history[history.length - 1];
  const residualScale = Math.max(
    parameters.residual_stddev,
    parameters.stddev * 0.1,
    Math.abs(parameters.mean) * 0.005,
    1e-6,
  );
  const residualZ = Math.abs(history[history.length - 1] - expectedCurrent) / residualScale;
  const anomalyRisk = clamp(residualZ * 18, 0, 100);
  return {
    risk: clamp(Math.max(thresholdRisk, anomalyRisk), 0, 100),
    predictions,
    next_prediction: nextPrediction,
    expected_current: expectedCurrent,
    residual_z: residualZ,
  };
}

module.exports = {
  assessThreshold,
  fitAutoregression,
  forecast,
  mean,
  predictNext,
  scoreForecast,
  stddev,
};
