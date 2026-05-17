from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import logging

from .schemas import AnalyzeRequest, AnalyzeResponse
from .analyzer import MetricsAnalyzer

# ─── Setup Logging ───────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ─── Create FastAPI App ──────────────────────────────────────────────────
app = FastAPI(
    title="CloudShadow AI Service",
    description="AI-powered server metrics analysis with anomaly detection, "
                "trend prediction, and root cause analysis",
    version="1.0.0"
)

# ─── CORS (allow Spring Boot to call) ────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Initialize Analyzer ─────────────────────────────────────────────────
analyzer = MetricsAnalyzer()


# ─── Health Check ────────────────────────────────────────────────────────
@app.api_route("/health", methods=["GET", "HEAD"])
def health_check():
    return {"status": "healthy", "service": "cloudshadow-ai"}


# ─── Main Analysis Endpoint ──────────────────────────────────────────────
@app.post("/analyze", response_model=AnalyzeResponse)
def analyze_metrics(request: AnalyzeRequest):
    """
    Analyzes server metrics and returns:
    - Anomaly detection (Z-score based)
    - Trend prediction (Linear Regression)
    - Root cause analysis (Rule-based correlation)
    - Actionable alert with recommendation

    Requires at least 10 metric data points for meaningful analysis.
    """

    logger.info(f"🤖 Analyzing server: {request.serverName} ({len(request.metrics)} metrics)")

    # Validate minimum data
    if len(request.metrics) < 10:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least 10 metrics for analysis, got {len(request.metrics)}"
        )

    try:
        result = analyzer.analyze(request)

        if result.alert.shouldAlert:
            logger.info(
                f"🚨 Alert for {request.serverName}: "
                f"{result.alert.type} - {result.alert.severity} "
                f"(confidence: {result.alert.confidenceScore})"
            )
        else:
            logger.info(f"✅ No issues detected for {request.serverName}")

        return result

    except Exception as e:
        logger.error(f"❌ Analysis failed for {request.serverName}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {str(e)}"
        )


# ─── Startup Event ───────────────────────────────────────────────────────
@app.on_event("startup")
async def startup_event():
    logger.info("🚀 CloudShadow AI Service started")
    logger.info("   - Anomaly Detection: Z-score (σ threshold)")
    logger.info("   - Trend Prediction: Linear Regression")
    logger.info("   - Root Cause: Rule-based correlation engine")