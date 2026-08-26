// src/utils/forecast.ts

// Simple linear regression
export function linearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R-squared (coefficient of determination)
  const yMean = sumY / n;
  const ssTot = y.reduce((a, b) => a + (b - yMean) ** 2, 0);
  const ssRes = y.reduce((a, b, i) => a + (b - (slope * x[i] + intercept)) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);

  return { slope, intercept, r2 };
}

export function forecastNextMonth(expenses: number[]): { predicted: number; lower: number; upper: number; r2: number } | null {
  const recent = expenses.slice(-6); // last 6 months
  if (recent.length < 3) return null; // need at least 3 data points

  const x = Array.from({ length: recent.length }, (_, i) => i);
  const y = recent;
  const { slope, intercept, r2 } = linearRegression(x, y);

  const nextX = recent.length; // e.g., if 6 points, next index = 6
  const predicted = Math.max(0, slope * nextX + intercept);

  // Approximate 80% prediction interval based on residual standard deviation
  const residuals = y.map((yi, i) => yi - (slope * x[i] + intercept));
  const stdErr = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / (y.length - 2));
  const margin = stdErr * 1.28; // 80% confidence

  return {
    predicted: Math.round(predicted),
    lower: Math.round(Math.max(0, predicted - margin)),
    upper: Math.round(predicted + margin),
    r2,
  };
}
