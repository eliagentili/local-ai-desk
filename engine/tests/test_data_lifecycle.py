"""Working copies of the user's documents must not outlive the session.

Uploads are streamed into per-job directories and deleted when the job ends, but
a crash or a force quit skips that cleanup. The next start is the last chance to
remove them, and the promise the product makes is that nothing lingers.
"""

from __future__ import annotations

import time
import unittest

from unittest.mock import patch

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


class ParentSupervisionTests(unittest.TestCase):
    """The engine must not outlive the app that started it.

    A normal quit is handled by the app itself, but a crash, a Force Quit or a
    `kill -9` skips that. Without this the engine — and the models it holds in
    memory — would keep running on the user's machine indefinitely.
    """

    def test_reparenting_is_treated_as_the_app_being_gone(self):
        # On POSIX the kernel re-parents an orphan to init: an immediate and
        # unambiguous signal, unlike probing a pid that may be a zombie.
        with patch.object(main, "APP_PID", 4242), patch.object(main.os, "getppid", return_value=1):
            self.assertTrue(main.parent_is_gone())

    def test_a_live_parent_keeps_the_engine_running(self):
        with patch.object(main, "APP_PID", main.os.getppid()):
            self.assertFalse(main.parent_is_gone())

    def test_a_dead_pid_is_detected_even_without_reparenting(self):
        # The Windows path has no parent relationship to lean on.
        with patch.object(main, "APP_PID", 4242), patch.object(main.os, "name", "nt"), patch.object(
            main, "process_is_alive", return_value=False
        ):
            self.assertTrue(main.parent_is_gone())

    def test_an_engine_started_by_hand_is_never_supervised(self):
        # APP_PID is unset for a manual run, which must not shut itself down.
        with patch.object(main, "APP_PID", 0):
            self.assertFalse(main.process_is_alive(0))

    def test_only_an_ollama_we_started_is_ever_stopped(self):
        # An instance the user was already running belongs to them.
        with patch.object(main, "OLLAMA_PID", 0), patch.object(main.os, "kill") as kill:
            main.stop_owned_ollama()
            kill.assert_not_called()


if __name__ == "__main__":
    unittest.main()
