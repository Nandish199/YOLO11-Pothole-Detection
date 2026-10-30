from pydantic import BaseModel, Field


class DetectionConfidenceUpdate(BaseModel):
    confidence: float = Field(ge=0.3, le=0.95)


class DetectionConfidenceResponse(BaseModel):
    confidence: float
    minimum: float = 0.3
    maximum: float = 0.95
