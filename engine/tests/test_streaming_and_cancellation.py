from __future__ import annotations

import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from fastapi import Response

from backend.app import main
from backend.app.engines import (
    EngineResult,
    PDFTranslationResult,
    ProcessingCancelled,
    transcribe,
)


class StreamingUploadTests(unittest.TestCase):
    def test_raw_upload_is_streamed_and_processed(self):
        client = TestClient(main.app)
        result = EngineResult(output="testo", engine="fake", output_format="txt")
        with patch.object(main, "process_file", return_value=result):
            response = client.post(
                "/api/process-file",
                params={
                    "tool": "faster-whisper",
                    "output_format": "txt",
                    "filename": "video grande.mp4",
                    "job_id": "stream-test",
                },
                content=b"video-bytes",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["filename"], "video-grande.txt")
        self.assertEqual(payload["meta"]["input_bytes"], 11)
        self.assertTrue(payload["meta"]["streamed_upload"])

    def test_cancel_endpoint_sets_the_job_event(self):
        job_id, event = main.register_job("cancel-test")
        try:
            response = main.cancel_job(job_id)
            self.assertTrue(response["cancelled"])
            self.assertTrue(event.is_set())
            status = main.job_status(job_id, Response())
            self.assertEqual(status["state"], "cancelling")
        finally:
            main.unregister_job(job_id)

    def test_job_status_exposes_real_translation_progress(self):
        job_id, _event = main.register_job("progress-test")
        try:
            main.update_job_progress(
                job_id,
                state="processing",
                progress=63.12,
                stage="Translate Paragraphs",
                stage_label="Traduzione dei paragrafi",
                stage_progress=50.0,
                stage_current=4,
                stage_total=8,
            )
            status = main.job_status(job_id, Response())
            self.assertEqual(status["progress"], 63.12)
            self.assertEqual(status["stage_label"], "Traduzione dei paragrafi")
            self.assertEqual(status["stage_current"], 4)
            self.assertEqual(status["stage_total"], 8)
        finally:
            main.unregister_job(job_id)

    def test_pdf_translation_streams_a_binary_result(self):
        client = TestClient(main.app)

        def fake_translation(
            source,
            output_dir,
            source_language,
            target_language,
            mode,
            event,
            progress_callback,
        ):
            progress_callback(
                {
                    "state": "processing",
                    "progress": 62.5,
                    "stage": "Translate Paragraphs",
                    "stage_label": "Traduzione dei paragrafi",
                    "stage_progress": 50.0,
                    "stage_current": 4,
                    "stage_total": 8,
                }
            )
            output_dir.mkdir(parents=True, exist_ok=True)
            translated = output_dir / "documento.it.mono.pdf"
            translated.write_bytes(b"%PDF-1.7\ntranslated")
            return PDFTranslationResult(
                path=translated,
                filename="documento.it.tradotto.pdf",
                meta={"target_language": target_language},
            )

        with patch.object(main, "process_pdf_translation", side_effect=fake_translation):
            response = client.post(
                "/api/translate-pdf",
                params={
                    "source_language": "en",
                    "target_language": "it",
                    "mode": "translated",
                    "filename": "documento.pdf",
                    "job_id": "translation-test",
                },
                content=b"%PDF-1.7\nsource",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/pdf")
        self.assertIn("documento.it.tradotto.pdf", response.headers["content-disposition"])
        self.assertEqual(response.content, b"%PDF-1.7\ntranslated")
        progress_response = client.get("/api/jobs/translation-test/status")
        self.assertEqual(progress_response.status_code, 200)
        self.assertEqual(progress_response.json()["state"], "completed")
        self.assertEqual(progress_response.json()["progress"], 100.0)


class WhisperCancellationTests(unittest.TestCase):
    def test_transcription_stops_between_segments(self):
        cancel_event = threading.Event()
        segment = SimpleNamespace(start=0.0, end=1.0, text="prima parte")
        info = SimpleNamespace(language="it", language_probability=0.99)

        def segments():
            yield segment
            cancel_event.set()
            yield segment

        model = SimpleNamespace(transcribe=lambda *args, **kwargs: (segments(), info))
        with patch("backend.app.engines._whisper_model", return_value=model):
            with self.assertRaises(ProcessingCancelled):
                transcribe(Path("video.mp4"), "auto", "txt", cancel_event)


if __name__ == "__main__":
    unittest.main()
