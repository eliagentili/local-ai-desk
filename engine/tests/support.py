"""Shared helpers for the engine tests.

Every `/api/*` route is behind the local token the desktop app hands over at
spawn time, so tests have to present it the same way the native client does.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app import main


TEST_TOKEN = "test-token-0123456789abcdef"


def local_client() -> TestClient:
    """A client that authenticates like the desktop app does."""
    main.ENGINE_TOKEN = TEST_TOKEN
    return TestClient(main.app, headers={"X-Local-Token": TEST_TOKEN})
