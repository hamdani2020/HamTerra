"""Importing this package registers every model on ``Base.metadata``."""

from app.db.models.areas import Area
from app.db.models.audit import AuditEvent
from app.db.models.observations import Observation
from app.db.models.reports import Comparison, Report
from app.db.models.retrievals import RetrievalRecord
from app.db.models.settings import AppSetting
from app.db.models.users import User

__all__ = [
    "AppSetting",
    "Area",
    "AuditEvent",
    "Comparison",
    "Observation",
    "Report",
    "RetrievalRecord",
    "User",
]
