"""Model packs are fetched on request, not imposed on every installation.

The Privacy Filter checkpoint is 2.6 GB and only matters to people who mask
personal data. Until it arrives the engine still works on the Italian rules
alone — what must never happen is the user being left with a bare "6/7" and no
way to act on it.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from backend.app import engines
from support import local_client


class ModelPackTests(unittest.TestCase):
    def tearDown(self) -> None:
        engines._MODEL_DOWNLOADS.clear()

    def test_the_privacy_checkpoint_is_offered_as_a_separate_pack(self):
        pack = engines.MODEL_PACKS["privacy"]
        self.assertEqual(pack.repo_id, "openai/privacy-filter")
        self.assertGreater(pack.approximate_bytes, 0, "the user is told the cost up front")

    def test_status_marks_a_downloadable_engine_so_the_ui_can_offer_it(self):
        payload = local_client().get("/api/status").json()
        privacy = payload["engines"]["privacy"]
        self.assertTrue(privacy["downloadable"])
        self.assertIn("pack_label", privacy)
        # Engines whose models arrive with the install are not offered.
        self.assertNotIn("downloadable", payload["engines"]["markitdown"])

    def test_a_download_is_started_once_and_reports_progress(self):
        with patch.object(engines.threading, "Thread") as thread:
            first = engines.start_model_download("privacy")
            self.assertEqual(first["state"], "downloading")
            self.assertEqual(thread.call_count, 1)

            # Pressing the button again must not start a second download.
            second = engines.start_model_download("privacy")
            self.assertEqual(second["state"], "downloading")
            self.assertEqual(thread.call_count, 1)

        state = local_client().get("/api/status").json()["engines"]["privacy"]["download"]
        self.assertEqual(state["state"], "downloading")

    def test_an_unknown_engine_is_refused_rather_than_silently_ignored(self):
        with self.assertRaises(KeyError):
            engines.start_model_download("markitdown")
        self.assertEqual(
            local_client().post("/api/models/markitdown/download").status_code, 404
        )

    def test_a_failed_download_leaves_an_actionable_message(self):
        pack = engines.MODEL_PACKS["privacy"]
        with patch.dict(
            "sys.modules",
            {"huggingface_hub": None},  # importing it raises, as an offline run would
        ):
            engines._run_model_download(pack)
        state = engines.model_download_state("privacy")
        self.assertEqual(state["state"], "error")
        self.assertIn("riprova", state["error"].lower())


if __name__ == "__main__":
    unittest.main()
