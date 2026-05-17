import numpy as np
from sklearn.linear_model import LinearRegression
from typing import Tuple, Optional


class TrendPredictor:
    """
    Uses Linear Regression to predict future metric values.

    Why Linear Regression:
    - Simple, fast, interpretable
    - Works with limited data points
    - Gives us slope (trend direction + speed)
    - Easy to explain in interviews
    """

    # Thresholds for alerts
    CRITICAL_THRESHOLD = 90.0
    WARNING_THRESHOLD = 75.0

    def __init__(self):
        self.model = LinearRegression()

    def predict_trend(
            self,
            values: np.ndarray,
            timestamps_seconds: np.ndarray
    ) -> Tuple[bool, float, Optional[int], float, float]:
        """
        Analyzes trend and predicts when threshold will be exceeded.

        Args:
            values: Array of metric values (e.g., CPU readings)
            timestamps_seconds: Array of timestamps in seconds from start

        Returns:
            Tuple of:
            - will_exceed: Will it exceed WARNING threshold?
            - predicted_value: Predicted value at current trend
            - minutes_until_threshold: When will it hit CRITICAL?
            - slope: Rate of change per minute
            - confidence: R² score of the model
        """

        if len(values) < 5:
            # Not enough data
            return False, values[-1], None, 0.0, 0.0

        # Reshape for sklearn
        X = timestamps_seconds.reshape(-1, 1)
        y = values

        # Fit linear regression
        self.model.fit(X, y)

        # Get predictions and metrics
        slope_per_second = self.model.coef_[0]
        slope_per_minute = slope_per_second * 60
        intercept = self.model.intercept_

        # R² score as confidence
        y_pred = self.model.predict(X)
        ss_res = np.sum((y - y_pred) ** 2)
        ss_tot = np.sum((y - np.mean(y)) ** 2)
        r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0
        confidence = max(0, min(1, r_squared))

        # Current and predicted values
        current_value = values[-1]
        latest_time = timestamps_seconds[-1]

        # Predict 30 minutes ahead
        future_time = latest_time + (30 * 60)
        predicted_value = self.model.predict([[future_time]])[0]

        # Will it exceed threshold?
        will_exceed = slope_per_minute > 0.1 and predicted_value > self.WARNING_THRESHOLD

        # Calculate time until CRITICAL threshold
        minutes_until_critical = None
        if slope_per_second > 0 and current_value < self.CRITICAL_THRESHOLD:
            seconds_until = (self.CRITICAL_THRESHOLD - current_value) / slope_per_second
            minutes_until_critical = int(seconds_until / 60)

            # Cap at reasonable values
            if minutes_until_critical > 1440:  # More than 24 hours
                minutes_until_critical = None

        return (
            will_exceed,
            round(predicted_value, 1),
            minutes_until_critical,
            round(slope_per_minute, 3),
            round(confidence, 2)
        )

    def analyze_all_metrics(
            self,
            metrics_history: dict
    ) -> dict:
        """
        Analyzes trends for all metric types.

        Args:
            metrics_history: Dict with keys 'cpu', 'memory', 'disk',
                           'networkIn', 'networkOut', 'timestamps_seconds'

        Returns:
            Dict with predictions for each metric type
        """

        timestamps = metrics_history['timestamps_seconds']
        results = {}

        for metric_name in ['cpu', 'memory', 'disk']:
            values = metrics_history[metric_name]

            will_exceed, predicted, minutes, slope, conf = self.predict_trend(
                values, timestamps
            )

            results[metric_name] = {
                'willExceed': will_exceed,
                'currentValue': round(float(values[-1]), 1),
                'predictedValue': predicted,
                'minutesUntilCritical': minutes,
                'slopePerMinute': slope,
                'confidence': conf
            }

        # Find the worst trending metric
        worst = None
        worst_score = 0

        for name, data in results.items():
            if data['willExceed']:
                # Score based on how soon and how confident
                score = data['confidence']
                if data['minutesUntilCritical']:
                    score += (60 - min(60, data['minutesUntilCritical'])) / 60

                if score > worst_score:
                    worst_score = score
                    worst = name

        return {
            'metrics': results,
            'worstTrending': worst
        }