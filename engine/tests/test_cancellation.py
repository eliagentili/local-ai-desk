"""Cancelling a job must stop the work, not only the waiting.

Three engines — MarkItDown, Docling and the Privacy Filter — used to run their
single blocking call inside this server: the interface said "annullato" while a
core kept working and the per-engine slot stayed held, which for `privacy` and
`paddleocr` is the only slot there is. These tests pin, for each of the six
engines, the three facts that make a cancellation real: the job raises
`ProcessingCancelled`, no child process is left running, and the engine slot is
free for the next job.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import Response

from backend.app import engines, main
from support import local_client


PNG_HEADER = b"\x89PNG\r\n\x1a\n"


def stalling_worker_command(_engine: str) -> list[str]:
    """A worker that accepts the request and then never answers.

    Stands in for a conversion that has started and cannot be interrupted from
    the inside: the only way out is terminating the process.
    """
    return [
        sys.executable,
        "-c",
        "import sys, time; sys.stdin.readline(); time.sleep(120)",
    ]


class EngineSlotAssertions(unittest.TestCase):
    def assertSlotIsFree(self, engine: str) -> None:
        """Every permit of the engine's semaphore is back in the pool."""
        semaphore = engines._ENGINE_SEMAPHORES[engine]
        limit = engines.ENGINE_CONCURRENCY[engine]
        acquired = [semaphore.acquire(timeout=0.5) for _ in range(limit)]
        for taken in acquired:
            if taken:
                semaphore.release()
        self.assertTrue(
            all(acquired),
            f"il motore «{engine}» è rimasto occupato dopo l’annullamento",
        )

    def assertNoWorkerProcessSurvives(self) -> None:
        for process in engines.active_engine_worker_processes():
            self.assertIsNotNone(
                process.poll(),
                "un processo del motore è rimasto vivo dopo l’annullamento",
            )


class WorkerEngineCancellationTests(EngineSlotAssertions):
    """markitdown, docling and privacy run in a process we can terminate."""

    def tearDown(self) -> None:
        engines.stop_all_engine_workers()

    def cancel_during(self, tool: str, path: Path) -> subprocess.Popen:
        cancel_event = threading.Event()
        started = threading.Event()
        spawned: list[subprocess.Popen] = []
        original_spawn = engines._spawn_worker

        def spawn(engine: str):
            worker = original_spawn(engine)
            spawned.append(worker.process)
            started.set()
            return worker

        failures: list[BaseException] = []

        def run() -> None:
            try:
                engines.process_file(path, tool, "markdown", "auto", cancel_event)
            except BaseException as exc:  # asserted below, on the main thread
                failures.append(exc)

        with (
            patch.object(engines, "_worker_command", stalling_worker_command),
            patch.object(engines, "_spawn_worker", spawn),
        ):
            job = threading.Thread(target=run)
            job.start()
            self.assertTrue(started.wait(20), "il motore non è stato avviato")
            # Give the worker time to have taken the request in hand.
            time.sleep(0.3)
            cancel_event.set()
            job.join(20)
            self.assertFalse(job.is_alive(), "l’annullamento non ha sbloccato il lavoro")

        self.assertEqual(len(failures), 1)
        self.assertIsInstance(failures[0], engines.ProcessingCancelled)
        self.assertEqual(len(spawned), 1)
        return spawned[0]

    def test_markitdown_is_interrupted_and_frees_its_slot(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            source = Path(raw_dir) / "nota.txt"
            source.write_text("contenuto", encoding="utf-8")
            process = self.cancel_during("markitdown", source)
        self.assertIsNotNone(process.poll(), "il processo del motore è rimasto vivo")
        self.assertNoWorkerProcessSurvives()
        self.assertSlotIsFree("markitdown")

    def test_docling_is_interrupted_and_frees_its_slot(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            source = Path(raw_dir) / "relazione.txt"
            source.write_text("contenuto", encoding="utf-8")
            process = self.cancel_during("docling", source)
        self.assertIsNotNone(process.poll())
        self.assertNoWorkerProcessSurvives()
        self.assertSlotIsFree("docling")

    def test_privacy_is_interrupted_and_frees_its_only_slot(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            source = Path(raw_dir) / "dati.txt"
            source.write_text("Mario Rossi, mario@example.com", encoding="utf-8")
            process = self.cancel_during("privacy", source)
        self.assertIsNotNone(process.poll())
        self.assertNoWorkerProcessSurvives()
        # A held permit here is the worst case of all: privacy has exactly one.
        self.assertSlotIsFree("privacy")

    def test_a_worker_that_dies_is_never_handed_to_the_next_job(self):
        with (
            patch.object(engines, "_worker_command", stalling_worker_command),
        ):
            worker = engines._checkout_worker("markitdown")
            engines._release_worker("markitdown", worker)
            self.assertEqual(len(engines._ENGINE_WORKERS["markitdown"]), 1)
            worker.process.kill()
            worker.process.wait(timeout=10)
            replacement = engines._checkout_worker("markitdown")
            self.assertIsNot(replacement, worker)
            self.assertIsNone(replacement.process.poll())


class WhisperCancellationTests(EngineSlotAssertions):
    def test_transcription_stops_between_segments_and_frees_its_slot(self):
        cancel_event = threading.Event()
        segment = SimpleNamespace(start=0.0, end=1.0, text="prima parte")
        info = SimpleNamespace(language="it", language_probability=0.99)

        def segments():
            yield segment
            cancel_event.set()
            yield segment

        model = SimpleNamespace(transcribe=lambda *args, **kwargs: (segments(), info))
        with tempfile.TemporaryDirectory() as raw_dir:
            source = Path(raw_dir) / "intervista.mp3"
            source.write_bytes(b"ID3 audio")
            with patch.object(engines, "_whisper_model", return_value=model):
                with self.assertRaises(engines.ProcessingCancelled):
                    engines.process_file(source, "auto", "txt", "it", cancel_event)
        self.assertSlotIsFree("faster-whisper")


class PaddleCancellationTests(EngineSlotAssertions):
    def test_ocr_stops_between_pages_and_frees_its_only_slot(self):
        cancel_event = threading.Event()

        def pages():
            yield SimpleNamespace(markdown={"markdown_texts": "prima pagina"})
            cancel_event.set()
            yield SimpleNamespace(markdown={"markdown_texts": "seconda pagina"})

        pipeline = SimpleNamespace(
            predict=lambda **_kwargs: pages(),
            concatenate_markdown_pages=lambda _pages: {"markdown_texts": "testo"},
        )
        with tempfile.TemporaryDirectory() as raw_dir:
            source = Path(raw_dir) / "scansione.png"
            source.write_bytes(PNG_HEADER + b"immagine")
            with patch.object(engines, "_paddle_pipeline", return_value=pipeline):
                with self.assertRaises(engines.ProcessingCancelled):
                    engines.process_file(
                        source, "paddleocr", "markdown", "auto", cancel_event
                    )
        self.assertSlotIsFree("paddleocr")


class GlmCancellationTests(EngineSlotAssertions):
    def test_glm_stops_between_pages_and_frees_its_slot(self):
        cancel_event = threading.Event()

        def ollama(path, payload=None, timeout=4):
            if path == "/api/generate":
                cancel_event.set()
            return {"response": "testo"}

        with tempfile.TemporaryDirectory() as raw_dir:
            source = Path(raw_dir) / "scansione.png"
            source.write_bytes(PNG_HEADER + b"immagine")
            with patch.object(engines, "_ollama_request", side_effect=ollama):
                with self.assertRaises(engines.ProcessingCancelled):
                    engines.process_file(
                        source, "glmocr", "markdown", "auto", cancel_event
                    )
        self.assertSlotIsFree("glmocr")


class TranslationCancellationTests(EngineSlotAssertions):
    def test_the_translation_worker_is_terminated_and_the_slot_freed(self):
        class ActiveProcess:
            returncode = None
            pid = 4243

            def poll(self):
                return self.returncode

            def wait(self, timeout=None):
                self.returncode = -15
                return self.returncode

            def terminate(self):
                self.returncode = -15

        class CancelOnWait:
            def is_set(self):
                return False

            def wait(self, _timeout):
                return True

        process = ActiveProcess()
        tags = {"models": [{"name": "translategemma:12b"}]}
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            source = root / "source.pdf"
            source.write_bytes(b"%PDF-1.7\n")
            bin_dir = root / "bin"
            bin_dir.mkdir()
            cli = bin_dir / "pdf2zh_next"
            cli.touch()
            (bin_dir / "python").touch()
            worker = root / "pdf_translation_worker.py"
            worker.touch()
            with (
                patch.object(engines, "find_binary", return_value=str(cli)),
                patch.object(engines, "PDF_TRANSLATION_WORKER", worker),
                patch.object(engines, "_ollama_request", return_value=tags),
                patch.object(engines.subprocess, "Popen", return_value=process),
            ):
                with self.assertRaises(engines.ProcessingCancelled):
                    engines.process_pdf_translation(
                        source, root / "out", "en", "it", "translated", CancelOnWait()
                    )
        self.assertEqual(process.returncode, -15, "il worker non è stato terminato")
        self.assertSlotIsFree("pdf-translate")


class JobDeadlineTests(unittest.TestCase):
    """An engine that is alive but wedged must not hold a job forever.

    The desktop watchdog only checks that this server answers, so without a
    ceiling per job the interface would show a lavoro in corso for as long as the
    app runs, with nothing the user can act on.
    """

    def test_a_job_that_never_ends_fails_with_an_actionable_message(self):
        client = local_client()

        def wedged(source, tool, output_format, language, cancel_event):
            # Cooperative, like the engines that check the event: what is being
            # tested is that the ceiling is what ends the job.
            for _ in range(200):
                if cancel_event.wait(0.05):
                    raise engines.ProcessingCancelled("annullato")
            raise AssertionError("il tetto di durata non è scattato")

        with (
            patch.object(main, "JOB_TIMEOUT_SECONDS", 0.2),
            patch.object(main, "JOB_TIMEOUT_GRACE_SECONDS", 5.0),
            patch.object(main, "process_file", side_effect=wedged),
        ):
            response = client.post(
                "/api/process-file",
                params={"tool": "markitdown", "output_format": "txt"},
                headers={"X-Local-Filename": "verbale.docx"},
                content=b"contenuto",
            )

        self.assertEqual(response.status_code, 504)
        detail = response.json()["detail"]
        self.assertIn("tempo massimo", detail)
        self.assertIn("Riprova", detail)

    def test_the_declared_ceiling_is_stated_in_hours(self):
        with patch.object(main, "JOB_TIMEOUT_SECONDS", 12 * 3600):
            self.assertIn("12 ore", main.deadline_message())
        with patch.object(main, "JOB_TIMEOUT_SECONDS", 3600):
            self.assertIn("un’ora", main.deadline_message())
        with patch.object(main, "JOB_TIMEOUT_SECONDS", 600):
            self.assertIn("10 minuti", main.deadline_message())

    def test_a_disabled_ceiling_lets_a_long_job_finish(self):
        client = local_client()
        result = engines.EngineResult(output="testo", engine="fake", output_format="txt")
        with (
            patch.object(main, "JOB_TIMEOUT_SECONDS", 0),
            patch.object(main, "process_file", return_value=result),
        ):
            response = client.post(
                "/api/process-file",
                params={"tool": "markitdown", "output_format": "txt"},
                content=b"contenuto",
            )
        self.assertEqual(response.status_code, 200)

    def test_an_expired_job_is_reported_as_failed_not_as_still_running(self):
        job_id, cancel_event = main.register_job("deadline-state")
        try:
            with (
                patch.object(main, "JOB_TIMEOUT_SECONDS", 0.1),
                patch.object(main, "JOB_TIMEOUT_GRACE_SECONDS", 2.0),
            ):
                async def call():
                    return await main.run_engine(
                        job_id, cancel_event, lambda: time.sleep(1.0)
                    )

                import asyncio

                with self.assertRaises(main.JobDeadlineExceeded):
                    asyncio.run(call())
            self.assertEqual(main.job_status(job_id, Response())["state"], "error")
            self.assertTrue(cancel_event.is_set())
        finally:
            main.unregister_job(job_id)


if __name__ == "__main__":
    unittest.main()
