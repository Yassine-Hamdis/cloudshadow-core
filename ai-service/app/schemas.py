from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


# ─── Request from Spring Boot ───────────────────────────────────────────

class MetricData(BaseModel):
    cpu: float
    memory: float
    disk: float
    networkIn: Optional[float] = 0.0
    networkOut: Optional[float] = 0.0
    timestamp: datetime


class AnalyzeRequest(BaseModel):
    serverId: int
    serverName: str
    metrics: List[MetricData]


# ─── Response Components ────────────────────────────────────────────────

class AnomalyDetails(BaseModel):
    detected: bool
    metric: Optional[str] = None
    currentValue: Optional[float] = None
    baselineMean: Optional[float] = None
    baselineStd: Optional[float] = None
    zScore: Optional[float] = None


class PredictionDetails(BaseModel):
    willExceedThreshold: bool
    metric: str
    currentValue: float
    predictedValue: float
    predictedInMinutes: Optional[int] = None
    trendSlope: float
    confidence: float


class RootCauseDetails(BaseModel):
    detected: bool
    cause: Optional[str] = None
    details: Optional[str] = None
    correlatedMetrics: List[str] = []
    confidence: float


class AlertOutput(BaseModel):
    shouldAlert: bool
    type: Optional[str] = None
    severity: Optional[str] = None
    message: Optional[str] = None
    confidenceScore: Optional[float] = None
    predictionWindow: Optional[str] = None
    recommendedAction: Optional[str] = None


# ─── Full Response to Spring Boot ───────────────────────────────────────

class AnalyzeResponse(BaseModel):
    serverId: int
    serverName: str
    anomaly: AnomalyDetails
    prediction: PredictionDetails
    rootCause: RootCauseDetails
    alert: AlertOutput