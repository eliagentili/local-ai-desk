from __future__ import annotations

import tempfile
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app import engines


class FakeProcess:
    returncode = 0
    pid = 4242

    def poll(self):
        return 0


class FakeActiveProcess:
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


class PDFTranslationCommandTests(unittest.TestCase):
    def test_uses_local_ollama_and_requests_only_the_selected_pdf(self):
        captured: list[str] = []
        progress: list[dict[str, object]] = []

        def fake_popen(command, **_kwargs):
            captured.extend(command)
            return FakeProcess()

        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            source = root / "source.pdf"
            source.write_bytes(b"%PDF-1.7\n")
            output = root / "output"
            output.mkdir()
            (output / "source.it.mono.pdf").write_bytes(b"%PDF-1.7\ntranslated")
            bin_dir = root / ("Scripts" if os.name == "nt" else "bin")
            bin_dir.mkdir()
            fake_cli = bin_dir / ("pdf2zh_next.exe" if os.name == "nt" else "pdf2zh_next")
            fake_cli.touch()
            fake_python = bin_dir / ("python.exe" if os.name == "nt" else "python")
            fake_python.touch()
            fake_worker = root / "pdf_translation_worker.py"
            fake_worker.touch()

            tags = {"models": [{"name": "translategemma:12b"}]}
            with (
                patch.object(engines, "find_binary", return_value=str(fake_cli)),
                patch.object(engines, "PDF_TRANSLATION_WORKER", fake_worker),
                patch.object(engines, "_ollama_request", return_value=tags),
                patch.object(engines.subprocess, "Popen", side_effect=fake_popen),
            ):
                result = engines.translate_pdf(
                    source,
                    output,
                    "en",
                    "it",
                    "translated",
                    progress_callback=progress.append,
                )

        self.assertEqual(result.filename, "source.it.tradotto.pdf")
        self.assertEqual(captured[0], str(fake_python))
        self.assertEqual(captured[1], str(fake_worker))
        self.assertIn("--progress-file", captured)
        self.assertIn("--ollama-host", captured)
        self.assertIn("translategemma:12b", captured)
        self.assertIn("--no-dual", captured)
        prompt = captured[captured.index("--custom-system-prompt") + 1]
        self.assertIn("English (en) to Italian (it) translator", prompt)
        self.assertIn("--auto-enable-ocr-workaround", captured)
        self.assertNotIn("--no-mono", captured)
        self.assertEqual(progress[0]["progress"], 4.0)
        self.assertEqual(progress[-1]["progress"], 100.0)

    def test_cancellation_terminates_the_translation_worker(self):
        process = FakeActiveProcess()
        tags = {"models": [{"name": "translategemma:12b"}]}

        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            source = root / "source.pdf"
            source.write_bytes(b"%PDF-1.7\n")
            bin_dir = root / ("Scripts" if os.name == "nt" else "bin")
            bin_dir.mkdir()
            fake_cli = bin_dir / ("pdf2zh_next.exe" if os.name == "nt" else "pdf2zh_next")
            fake_cli.touch()
            (bin_dir / ("python.exe" if os.name == "nt" else "python")).touch()
            fake_worker = root / "pdf_translation_worker.py"
            fake_worker.touch()
            with (
                patch.object(engines, "find_binary", return_value=str(fake_cli)),
                patch.object(engines, "PDF_TRANSLATION_WORKER", fake_worker),
                patch.object(engines, "_ollama_request", return_value=tags),
                patch.object(engines.subprocess, "Popen", return_value=process) as popen,
            ):
                with self.assertRaises(engines.ProcessingCancelled):
                    engines.translate_pdf(
                        source,
                        root / "output",
                        "en",
                        "it",
                        "translated",
                        CancelOnWait(),
                    )

        # The worker is signalled directly rather than by process group: on
        # POSIX it deliberately shares this server's group, so that the desktop
        # app can terminate the whole tree on quit. Signalling the group from
        # here would take the server down with it.
        self.assertEqual(process.returncode, -15)
        options = popen.call_args.kwargs
        if os.name == "nt":
            self.assertIn("creationflags", options)
        else:
            self.assertNotIn(
                "start_new_session",
                options,
                "a detached session would survive the app being closed",
            )


if __name__ == "__main__":
    unittest.main()
