import numpy as np
from datetime import datetime
from typing import List

from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    AnomalyDetails,
    PredictionDetails,
    RootCauseDetails,
    AlertOutput
)
from .models.predictor import TrendPredictor
from .models.anomaly import AnomalyDetector
from .engine.root_cause import RootCauseEngine


class MetricsAnalyzer:
    """
    Main analyzer that combines:
    1. TrendPredictor (Linear Regression)
    2. AnomalyDetector (Z-score)
    3. RootCauseEngine (Rule-based correlation)

    Produces actionable AI alerts with:
    - What's wrong
    - When it will get worse
    - Why it's happening
    - What to do about it
    """

    def __init__(self):
        self.predictor = TrendPredictor()
        self.anomaly_detector = AnomalyDetector()
        self.root_cause_engine = RootCauseEngine()

    def analyze(self, request: AnalyzeRequest) -> AnalyzeResponse:
        """
        Full analysis pipeline.

        Args:
            request: Contains serverId, serverName, and metrics array

        Returns:
            Complete analysis with anomaly, prediction, root cause, and alert
        """

        # ── Step 1: Convert metrics to numpy arrays ──────────────────────
        metrics_history = self._prepare_metrics(request.metrics)

        # ── Step 2: Run anomaly detection ────────────────────────────────
        anomaly_results = self.anomaly_detector.analyze_all_metrics(metrics_history)

        # ── Step 3: Run trend prediction ─────────────────────────────────
        prediction_results = self.predictor.analyze_all_metrics(metrics_history)

        # ── Step 4: Run root cause analysis ──────────────────────────────
        root_cause_results = self.root_cause_engine.analyze(
            metrics_history,
            anomaly_results,
            prediction_results
        )

        # ── Step 5: Build response ───────────────────────────────────────
        return self._build_response(
            request,
            metrics_history,
            anomaly_results,
            prediction_results,
            root_cause_results
        )

    def _prepare_metrics(self, metrics: List) -> dict:
        """Converts metric list to numpy arrays for analysis."""

        # Sort by timestamp (oldest first)
        sorted_metrics = sorted(metrics, key=lambda m: m.timestamp)

        # Extract arrays
        cpu = np.array([m.cpu for m in sorted_metrics])
        memory = np.array([m.memory for m in sorted_metrics])
        disk = np.array([m.disk for m in sorted_metrics])
        network_in = np.array([m.networkIn or 0.0 for m in sorted_metrics])
        network_out = np.array([m.networkOut or 0.0 for m in sorted_metrics])

        # Convert timestamps to seconds from start
        first_ts = sorted_metrics[0].timestamp
        timestamps_seconds = np.array([
            (m.timestamp - first_ts).total_seconds()
            for m in sorted_metrics
        ])

        return {
            'cpu': cpu,
            'memory': memory,
            'disk': disk,
            'networkIn': network_in,
            'networkOut': network_out,
            'timestamps_seconds': timestamps_seconds
        }

    def _build_response(
            self,
            request: AnalyzeRequest,
            metrics_history: dict,
            anomaly_results: dict,
            prediction_results: dict,
            root_cause_results: dict
    ) -> AnalyzeResponse:
        """Builds the final response object."""

        # ── Anomaly details ──────────────────────────────────────────────
        worst_anomaly = anomaly_results.get('worstAnomaly')
        anomaly_data = anomaly_results['metrics'].get(worst_anomaly, {}) if worst_anomaly else {}

        anomaly = AnomalyDetails(
            detected=worst_anomaly is not None,
            metric=worst_anomaly,
            currentValue=anomaly_data.get('currentValue'),
            baselineMean=anomaly_data.get('baselineMean'),
            baselineStd=anomaly_data.get('baselineStd'),
            zScore=anomaly_data.get('zScore')
        )

        # ── Prediction details ───────────────────────────────────────────
        worst_trend = prediction_results.get('worstTrending')
        focus_metric = worst_trend or worst_anomaly or 'cpu'
        pred_data = prediction_results['metrics'].get(focus_metric, {})

        prediction = PredictionDetails(
            willExceedThreshold=pred_data.get('willExceed', False),
            metric=focus_metric,
            currentValue=pred_data.get('currentValue', 0),
            predictedValue=pred_data.get('predictedValue', 0),
            predictedInMinutes=pred_data.get('minutesUntilCritical'),
            trendSlope=pred_data.get('slopePerMinute', 0),
            confidence=pred_data.get('confidence', 0)
        )

        # ── Root cause details ───────────────────────────────────────────
        root_cause = RootCauseDetails(
            detected=root_cause_results.get('detected', False),
            cause=root_cause_results.get('cause'),
            details=root_cause_results.get('details'),
            correlatedMetrics=root_cause_results.get('correlatedMetrics', []),
            confidence=root_cause_results.get('confidence', 0)
        )

        # ── Build alert output ───────────────────────────────────────────
        alert = self._build_alert(
            anomaly,
            prediction,
            root_cause,
            anomaly_results,
            request.serverName
        )

        return AnalyzeResponse(
            serverId=request.serverId,
            serverName=request.serverName,
            anomaly=anomaly,
            prediction=prediction,
            rootCause=root_cause,
            alert=alert
        )

    def _build_alert(
            self,
            anomaly: AnomalyDetails,
            prediction: PredictionDetails,
            root_cause: RootCauseDetails,
            anomaly_results: dict,
            server_name: str
    ) -> AlertOutput:
        """Builds the final alert with human-readable message."""

        # Should we alert?
        should_alert = anomaly.detected or prediction.willExceedThreshold

        if not should_alert:
            return AlertOutput(
                shouldAlert=False,
                type=None,
                severity=None,
                message=None,
                confidenceScore=None,
                predictionWindow=None,
                recommendedAction=None
            )

        # Determine severity
        worst_anomaly = anomaly_results.get('worstAnomaly')
        anomaly_data = anomaly_results['metrics'].get(worst_anomaly, {}) if worst_anomaly else {}
        severity = anomaly_data.get('severity', 'WARNING')

        if prediction.predictedInMinutes and prediction.predictedInMinutes < 15:
            severity = 'CRITICAL'

        # Determine type
        alert_type = anomaly.metric or prediction.metric

        # Build message
        message_parts = []

        if anomaly.detected:
            message_parts.append(
                f"{anomaly.metric} anomaly detected ({anomaly.zScore}σ above baseline)"
            )

        if prediction.willExceedThreshold and prediction.predictedInMinutes:
            message_parts.append(
                f"Predicted to reach {prediction.predictedValue}% in ~{prediction.predictedInMinutes} minutes"
            )

        if root_cause.detected and root_cause.cause:
            rule_info = self.root_cause_engine.get_rule_info(root_cause.cause)
            message_parts.append(
                f"Root cause: {rule_info['description']}"
            )

        message = ". ".join(message_parts) + "."

        # Get recommended action
        action = None
        if root_cause.detected and root_cause.cause:
            rule_info = self.root_cause_engine.get_rule_info(root_cause.cause)
            action = rule_info.get('action')

        # Calculate overall confidence
        confidence_scores = [
            prediction.confidence,
            root_cause.confidence
        ]
        if anomaly.detected and anomaly.zScore:
            # Higher z-score = higher confidence
            anomaly_conf = min(1.0, anomaly.zScore / 4.0)
            confidence_scores.append(anomaly_conf)

        overall_confidence = sum(confidence_scores) / len(confidence_scores)

        # Prediction window
        pred_window = None
        if prediction.predictedInMinutes:
            pred_window = f"{prediction.predictedInMinutes} minutes"

        return AlertOutput(
            shouldAlert=True,
            type=alert_type,
            severity=severity,
            message=message,
            confidenceScore=round(overall_confidence, 2),
            predictionWindow=pred_window,
            recommendedAction=action
        )