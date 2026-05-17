import numpy as np
from typing import Dict, List, Tuple, Optional


class RootCauseEngine:
    """
    Rule-based engine that correlates metrics to explain WHY
    an anomaly or trend is happening.

    This is the SMART part that makes alerts actionable.
    Instead of just "CPU is high", we explain:
    "CPU is high because network traffic spiked 5x"
    """

    # Correlation rules mapping symptoms to causes
    RULES = {
        'NETWORK_TRAFFIC_SPIKE': {
            'description': 'Sudden increase in network traffic',
            'action': 'Enable rate limiting or scale horizontally'
        },
        'MEMORY_LEAK': {
            'description': 'Memory growing steadily without release',
            'action': 'Restart service or investigate memory leak in application'
        },
        'DISK_FILLING': {
            'description': 'Disk usage growing rapidly',
            'action': 'Clean up logs/temp files or expand storage'
        },
        'LOG_EXPLOSION': {
            'description': 'Rapid disk growth with high CPU (logging overhead)',
            'action': 'Check for error loops causing excessive logging'
        },
        'RESOURCE_EXHAUSTION': {
            'description': 'Multiple resources near capacity',
            'action': 'Scale up server resources or distribute load'
        },
        'PROCESS_OVERLOAD': {
            'description': 'High CPU and memory without network cause',
            'action': 'Identify and optimize heavy process, or scale up'
        },
        'DATA_TRANSFER': {
            'description': 'High network out with CPU spike (serving data)',
            'action': 'Enable caching or CDN for static content'
        },
        'UNKNOWN': {
            'description': 'Anomaly detected but cause unclear',
            'action': 'Investigate server logs and running processes'
        }
    }

    def analyze(
            self,
            metrics_history: dict,
            anomaly_results: dict,
            prediction_results: dict
    ) -> dict:
        """
        Analyzes metrics to determine root cause of anomaly/trend.

        Args:
            metrics_history: Raw metric arrays
            anomaly_results: Output from AnomalyDetector
            prediction_results: Output from TrendPredictor

        Returns:
            Root cause analysis with explanation and action
        """

        worst_anomaly = anomaly_results.get('worstAnomaly')
        worst_trend = prediction_results.get('worstTrending')

        # If no issues detected
        if not worst_anomaly and not worst_trend:
            return {
                'detected': False,
                'cause': None,
                'details': None,
                'correlatedMetrics': [],
                'confidence': 0.0
            }

        # Focus on anomaly first, then trend
        focus_metric = worst_anomaly or worst_trend

        # Analyze correlations
        cause, details, correlated, confidence = self._find_root_cause(
            focus_metric,
            metrics_history,
            anomaly_results,
            prediction_results
        )

        return {
            'detected': True,
            'cause': cause,
            'details': details,
            'correlatedMetrics': correlated,
            'confidence': round(confidence, 2)
        }

    def _find_root_cause(
            self,
            focus_metric: str,
            metrics_history: dict,
            anomaly_results: dict,
            prediction_results: dict
    ) -> Tuple[str, str, List[str], float]:
        """
        Applies rules to find the most likely root cause.
        """

        # Extract current and historical values
        cpu = metrics_history['cpu']
        memory = metrics_history['memory']
        disk = metrics_history['disk']
        network_in = metrics_history.get('networkIn', np.zeros(len(cpu)))
        network_out = metrics_history.get('networkOut', np.zeros(len(cpu)))

        # Calculate changes
        cpu_change = self._calc_change(cpu)
        memory_change = self._calc_change(memory)
        disk_change = self._calc_change(disk)
        network_in_change = self._calc_change(network_in)
        network_out_change = self._calc_change(network_out)

        # Get current values
        cpu_current = cpu[-1]
        memory_current = memory[-1]
        disk_current = disk[-1]
        network_in_current = network_in[-1]
        network_out_current = network_out[-1]

        # Apply rules in order of specificity
        correlated = []

        # ── Rule 1: Network traffic spike causing CPU ────────────────────
        if focus_metric == 'cpu' and network_in_change > 100:
            network_in_first = network_in[0] if network_in[0] > 0 else 1
            spike_factor = round(network_in_current / network_in_first, 1)

            correlated = ['networkIn']
            if memory_change > 10:
                correlated.append('memory')

            return (
                'NETWORK_TRAFFIC_SPIKE',
                f"networkIn increased {spike_factor}x ({network_in[0]:.0f} → {network_in_current:.0f} KB/s) correlating with CPU rise",
                correlated,
                min(0.95, 0.7 + (network_in_change / 500))
            )

        # ── Rule 2: Memory leak pattern ──────────────────────────────────
        if focus_metric == 'memory' or (focus_metric == 'cpu' and memory_change > 15):
            # Check for steady increase without drops
            memory_increases = sum(1 for i in range(1, len(memory)) if memory[i] > memory[i - 1])
            increase_ratio = memory_increases / (len(memory) - 1)

            if increase_ratio > 0.75 and memory_change > 10:
                correlated = ['memory']
                if cpu_change > 10:
                    correlated.append('cpu')

                return (
                    'MEMORY_LEAK',
                    f"Memory growing steadily ({memory[0]:.1f}% → {memory_current:.1f}%) with {increase_ratio * 100:.0f}% of readings increasing",
                    correlated,
                    min(0.95, 0.6 + increase_ratio * 0.3)
                )

        # ── Rule 3: Disk filling up ──────────────────────────────────────
        if focus_metric == 'disk' or disk_change > 5:
            if disk_change > 3:
                correlated = ['disk']

                # Check if log explosion (disk + cpu)
                if cpu_change > 20:
                    correlated.append('cpu')
                    return (
                        'LOG_EXPLOSION',
                        f"Disk growing ({disk[0]:.1f}% → {disk_current:.1f}%) with high CPU - possible error loop causing excessive logging",
                        correlated,
                        0.75
                    )

                return (
                    'DISK_FILLING',
                    f"Disk usage increasing ({disk[0]:.1f}% → {disk_current:.1f}%) at {disk_change / len(disk) * 60:.1f}%/min",
                    correlated,
                    0.8
                )

        # ── Rule 4: High network out (serving data) ──────────────────────
        if network_out_change > 100 and cpu_change > 15:
            return (
                'DATA_TRANSFER',
                f"High outbound network ({network_out_current:.0f} KB/s) with CPU spike - serving heavy data",
                ['networkOut', 'cpu'],
                0.75
            )

        # ── Rule 5: Resource exhaustion (multiple high) ──────────────────
        high_count = sum([
            cpu_current > 70,
            memory_current > 70,
            disk_current > 70
        ])

        if high_count >= 2:
            correlated = []
            if cpu_current > 70:
                correlated.append('cpu')
            if memory_current > 70:
                correlated.append('memory')
            if disk_current > 70:
                correlated.append('disk')

            return (
                'RESOURCE_EXHAUSTION',
                f"Multiple resources near capacity: CPU {cpu_current:.0f}%, Memory {memory_current:.0f}%, Disk {disk_current:.0f}%",
                correlated,
                0.85
            )

        # ── Rule 6: Process overload (CPU + memory, no network) ──────────
        if focus_metric == 'cpu' and cpu_current > 60 and memory_current > 60:
            if network_in_change < 50 and network_out_change < 50:
                return (
                    'PROCESS_OVERLOAD',
                    f"High CPU ({cpu_current:.0f}%) and memory ({memory_current:.0f}%) without network cause",
                    ['cpu', 'memory'],
                    0.7
                )

        # ── Fallback: Unknown cause ──────────────────────────────────────
        return (
            'UNKNOWN',
            f"Anomaly in {focus_metric} detected but correlation unclear",
            [focus_metric],
            0.5
        )

    def _calc_change(self, values: np.ndarray) -> float:
        """Calculate percentage change from first to last value."""
        if len(values) < 2 or values[0] == 0:
            return 0.0
        return ((values[-1] - values[0]) / max(values[0], 1)) * 100

    def get_rule_info(self, cause: str) -> dict:
        """Gets description and action for a cause."""
        return self.RULES.get(cause, self.RULES['UNKNOWN'])