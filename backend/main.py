"""Точка входа: `uvicorn main:app`."""
import os

import uvicorn

from bpscanner.app import app  # noqa: F401

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8000")),
        reload=os.environ.get("ENV", "prod") == "dev",
        log_level="info",
    )
