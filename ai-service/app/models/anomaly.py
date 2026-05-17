import numpy as np
from typing import Tuple, Optional


class AnomalyDetector:
    """
    Uses Z-score (standard deviations from mean) to detect anomalies.

    Why Z-score:
    - Statistically sound and interpretable
    - Adapts to each server's normal baseline
    - Industry standard for monitoring
    - Easy to explain: "3σ above normal"
    """

    # Z-score threshold for anomaly
    # 2.0 = unusual (5% chance if normal)
    # 2.5 = very unusual (1% chance)
    # 3.0 = extremely unusual (0.3% chance)
    ANOMALY_THRESHOLD = 2.5
    CRITICAL_THRESHOLD = 3.0

    def detect_anomaly(
            self,
            values: np.ndarray
    ) -> Tuple[bool, Optional[float], float, float, float]:
        """
        Detects if the latest value is anomalous compared to history.

        Args:
            values: Array of metric values (oldest to newest)

        Returns:
            Tuple of:
            - is_anomaly: Is the latest value anomalous?
            - z_score: How many std devs from mean (None if not anomaly)
            - current_value: The latest value
            - mean: Baseline mean
            - std: Baseline standard deviation
        """

        if len(values) < 10:
            # Not enough data for meaningful statistics
            return False, None, values[-1], 0.0, 0.0

        # Use all but last value as baseline
        # This prevents the anomaly itself from skewing the baseline
        baseline = values[:-1]
        current = values[-1]

        mean = np.mean(baseline)
        std = np.std(baseline)

        # Avoid division by zero
        if std < 0.1:
            std = 0.1

        z_score = (current - mean) / std

        # We care about values ABOVE normal (high CPU, memory, etc.)
        # Negative z-scores (lower than normal) are usually good
        is_anomaly = z_score > self.ANOMALY_THRESHOLD

        return (
            is_anomaly,
            round(z_score, 2) if is_anomaly else None,
            round(float(current), 1),
            round(float(mean), 1),
            round(float(std), 2)
        )

    def analyze_all_metrics(
            self,
            metrics_history: dict
    ) -> dict:
        """
        Checks all metrics for anomalies.

        Args:
            metrics_history: Dict with 'cpu', 'memory', 'disk', etc.

        Returns:
            Dict with anomaly detection results
        """

        results = {}
        worst_anomaly = None
        worst_z_score = 0

        for metric_name in ['cpu', 'memory', 'disk', 'networkIn', 'networkOut']:
            values = metrics_history.get(metric_name)

            if values is None or len(values) < 10:
                continue

            is_anomaly, z_score, current, mean, std = self.detect_anomaly(values)

            results[metric_name] = {
                'isAnomaly': is_anomaly,
                'zScore': z_score,
                'currentValue': current,
                'baselineMean': mean,
                'baselineStd': std,
                'severity': self._get_severity(z_score) if is_anomaly else None
            }

            if is_anomaly and z_score and z_score > worst_z_score:
                worst_z_score = z_score
                worst_anomaly = metric_name

        return {
            'metrics': results,
            'worstAnomaly': worst_anomaly,
            'worstZScore': worst_z_score if worst_anomaly else None
        }

    def _get_severity(self, z_score: Optional[float]) -> str:
        """Determines severity based on z-score."""
        if z_score is None:
            return "NORMAL"
        if z_score >= self.CRITICAL_THRESHOLD:
            return "CRITICAL"
        if z_score >= self.ANOMALY_THRESHOLD:
            return "WARNING"
        return "NORMAL"