import json
from datetime import datetime, timezone
from pathlib import Path
import sys

# Safe path resolution regardless of working directory
_BACKEND_DIR = Path(__file__).resolve().parent
sys.path.append(str(_BACKEND_DIR))

from config import LOGS_DIR

LOGS_DIR.mkdir(parents=True, exist_ok=True)
AUDIT_LOG_PATH = LOGS_DIR / "audit.jsonl"


def log_event(
    agent: str,
    action: str,
    details: dict = None,
    citation: str = None,
    user_approval: bool = None
):
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "agent": agent,
        "action": action,
        "details": details or {},
        "citation": citation,
        "user_approval": user_approval
    }
    with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(event) + "\n")


def read_audit_log() -> list[dict]:
    if not AUDIT_LOG_PATH.exists():
        return []
    events = []
    with open(AUDIT_LOG_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return list(reversed(events))