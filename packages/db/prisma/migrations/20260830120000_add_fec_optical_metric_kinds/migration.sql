-- Add FEC (forward error correction) and optical-health metrics to MetricKind
-- so ONT micro-degradation (FEC growth, bias-current aging) can be collected
-- and detected before Rx power crosses the offline threshold.
ALTER TYPE "MetricKind" ADD VALUE 'FEC_CORRECTED';
ALTER TYPE "MetricKind" ADD VALUE 'FEC_UNCORRECTED';
ALTER TYPE "MetricKind" ADD VALUE 'BIAS_CURRENT_MA';
ALTER TYPE "MetricKind" ADD VALUE 'ONT_TEMPERATURE_CELSIUS';
