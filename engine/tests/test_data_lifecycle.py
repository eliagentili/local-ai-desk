"""Working copies of the user's documents must not outlive the session.

Uploads are streamed into per-job directories and deleted when the job ends, but
a crash or a force quit skips that cleanup. The next start is the last chance to
remove them, and the promise the product makes is that nothing lingers.
"""

from __future__ import annotations

import time
import unittest

from backend.app import main
from backend.app.config import JOBS_DIR


class OrphanSweepTests(unittest.TestCase):
    def tearDown(self) -> None:
        main.sweep_orphan_jobs()

    def test_leftover_job_directories_and_files_are_removed_at_startup(self):
        stale_dir = JOBS_DIR / "translation-crashed"
        stale_dir.mkdir(parents=True, exist_ok=True)
        (stale_dir / "document.pdf").write_bytes(b"%PDF-1.7 contenuto riservato")
        stale_file = JOBS_DIR / "orphan.bin"
        stale_file.write_bytes(b"resti")

        main.sweep_orphan_jobs()

        self.assertFalse(stale_dir.exists(), "a crashed job leaves no working copy")
        self.assertFalse(stale_file.exists())
        self.assertTrue(JOBS_DIR.exists(), "the jobs directory itself is kept")

    def test_sweeping_an_empty_directory_is_harmless(self):
        main.sweep_orphan_jobs()
        main.sweep_orphan_jobs()
        self.assertEqual(list(JOBS_DIR.iterdir()), [])


class ProgressPruningTests(unittest.TestCase):
    def tearDown(self) -> None:
        main._JOB_PROGRESS.clear()
        main._JOB_EVENTS.clear()

    def test_snapshots_of_finished_jobs_are_dropped_once_they_age_out(self):
        # Pruning used to happen only when a new job started, so an idle app
        # held every snapshot of the session in memory.
        main._JOB_PROGRESS["vecchio"] = {
            "job_id": "vecchio",
            "state": "completed",
            "updated_at": time.time() - (main._JOB_PROGRESS_TTL_SECONDS + 60),
        }
        main._JOB_PROGRESS["recente"] = {
            "job_id": "recente",
            "state": "completed",
            "updated_at": time.time(),
        }

        main.prune_job_progress()

        self.assertNotIn("vecchio", main._JOB_PROGRESS)
        self.assertIn("recente", main._JOB_PROGRESS)

    def test_a_running_job_is_never_pruned_however_long_it_takes(self):
        # A multi-hour transcription reports no progress of its own; dropping its
        # snapshot would make the desktop app lose track of a live job.
        main._JOB_EVENTS["lungo"] = object()  # type: ignore[assignment]
        main._JOB_PROGRESS["lungo"] = {
            "job_id": "lungo",
            "state": "running",
            "updated_at": time.time() - (main._JOB_PROGRESS_TTL_SECONDS * 10),
        }

        main.prune_job_progress()

        self.assertIn("lungo", main._JOB_PROGRESS)


if __name__ == "__main__":
    unittest.main()
