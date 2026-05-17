# Application Analyzer

## Request (from Spring Boot)
```json
// Request (from Spring Boot) {
{
  "serverId": 1,
  "serverName": "app-server-01",
  "metrics": [
    {
      "cpu": 45.0,
      "memory": 60.0,
      "disk": 30.0,
      "networkIn": 500.0,
      "networkOut": 200.0,
      "timestamp": "2024-01-15T14:00:00"
    },
    {
      "cpu": 52.0,
      "memory": 61.0,
      "disk": 30.0,
      "networkIn": 520.0,
      "networkOut": 210.0,
      "timestamp": "2024-01-15T14:00:20"
    },
    {
      "cpu": 78.0,
      "memory": 75.0,
      "disk": 30.5,
      "networkIn": 2500.0,
      "networkOut": 800.0,
      "timestamp": "2024-01-15T14:10:00"
    }
  ]
}

------------------------------------------------------
// Response (to Spring Boot)
{
  "isAnomaly": true,
  "anomalyDetails": {
    "metric": "CPU",
    "currentValue": 78.0,
    "baselineMean": 48.5,
    "baselineStd": 8.2,
    "zScore": 3.6
  },
  "prediction": {
    "willExceedThreshold": true,
    "predictedValue": 92.0,
    "predictedInMinutes": 25,
    "trendSlope": 2.1,
    "confidence": 0.85
  },
  "rootCause": {
    "cause": "NETWORK_TRAFFIC_SPIKE",
    "details": "networkIn increased 5x (500 → 2500 KB/s) correlating with CPU rise",
    "correlatedMetrics": ["networkIn", "memory"],
    "confidence": 0.82
  },
  "alert": {
    "shouldAlert": true,
    "type": "CPU",
    "severity": "WARNING",
    "message": "CPU anomaly detected (3.6σ above baseline). Predicted to reach 92% in ~25 minutes. Root cause: Network traffic spike (5x increase). Recommend: Enable rate limiting or scale horizontally.",
    "confidenceScore": 0.84,
    "predictionWindow": "25 minutes",
    "recommendedAction": "Enable rate limiting or scale horizontally"
  }
}