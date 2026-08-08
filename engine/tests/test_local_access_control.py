"""The engine listens on the loopback interface, which is not a private space.

Any other program on the machine can reach 127.0.0.1:8787, and so can any web
page the user happens to have open. These tests pin the gate that keeps the
user's documents reachable only by the desktop app that started the engine.
"""

from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from backend.app import main
from support import TEST_TOKEN, local_client


class LocalAccessControlTests(unittest.TestCase):
    def setUp(self) -> None:
        self._original_token = main.ENGINE_TOKEN

    def tearDown(self) -> None:
        main.ENGINE_TOKEN = self._original_token

    def test_the_desktop_app_is_allowed_through(self):
        client = local_client()
        response = client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

    def test_a_request_without_the_token_is_refused(self):
        main.ENGINE_TOKEN = TEST_TOKEN
        client = TestClient(main.app)
        for path in ("/api/health", "/api/status"):
            with self.subTest(path=path):
                self.assertEqual(client.get(path).status_code, 401)

    def test_a_wrong_token_is_refused(self):
        main.ENGINE_TOKEN = TEST_TOKEN
        client = TestClient(main.app, headers={"X-Local-Token": "guessed"})
        self.assertEqual(client.get("/api/health").status_code, 401)

    def test_a_browser_page_cannot_drive_the_engine(self):
        # Even holding the token, anything sending an Origin header is a browser
        # and never the native client.
        client = TestClient(
            main.app,
            headers={"X-Local-Token": TEST_TOKEN, "Origin": "https://example.invalid"},
        )
        main.ENGINE_TOKEN = TEST_TOKEN
        self.assertEqual(client.get("/api/health").status_code, 403)

    def test_cancelling_someone_elses_job_requires_the_token(self):
        main.ENGINE_TOKEN = TEST_TOKEN
        client = TestClient(main.app)
        response = client.post("/api/jobs/any-job/cancel")
        self.assertEqual(response.status_code, 401)

    def test_an_engine_started_without_a_token_refuses_everything(self):
        # Fail closed: a missing token must never mean "no authentication".
        main.ENGINE_TOKEN = ""
        client = TestClient(main.app, headers={"X-Local-Token": "anything"})
        self.assertEqual(client.get("/api/health").status_code, 503)


if __name__ == "__main__":
    unittest.main()
