import logging
import os
from pathlib import Path

os.environ["CHROMA_DISABLE_TELEMETRY"] = "1"
os.environ["ANONYMIZED_TELEMETRY"] = "False"

import chromadb
from chromadb.config import Settings
from chromadb.telemetry.product import ProductTelemetryClient, ProductTelemetryEvent
from overrides import override


class _SuppressVacuumNotice(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return "could benefit from vacuuming your database" not in record.getMessage()


class NoOpProductTelemetryClient(ProductTelemetryClient):
    @override
    def capture(self, event: ProductTelemetryEvent) -> None:
        return None


_SQLITE_LOGGER = logging.getLogger("chromadb.db.impl.sqlite")
_SQLITE_LOGGER.addFilter(_SuppressVacuumNotice())


def get_persistent_client(path: str | Path):
    settings = Settings(
        is_persistent=True,
        persist_directory=str(path),
        anonymized_telemetry=False,
        chroma_product_telemetry_impl="core.chroma_client.NoOpProductTelemetryClient",
        chroma_telemetry_impl="core.chroma_client.NoOpProductTelemetryClient",
    )
    return chromadb.PersistentClient(path=str(path), settings=settings)
