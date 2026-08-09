"""A file the user picked is not a file the engines can trust.

An archive is expanded by the conversion engine, so what it costs is decided by
what its headers declare and not by the size on disk; a protected PDF looks like
a scan and would be routed to OCR; an extension can simply lie. Every case here
must end in a sentence that tells the user what to do — never a traceback, never
a silent success, never an empty file presented as a result.
"""

from __future__ import annotations

import importlib.util
import io
import logging
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.app import engines, main
from support import local_client


HAS_PYMUPDF = importlib.util.find_spec("fitz") is not None


def fake_fitz(**attributes):
    """A stand-in for PyMuPDF, so the guard is pinned without the dependency."""

    def open_document(_path):
        if "error" in attributes:
            raise attributes["error"]
        return SimpleNamespace(
            needs_pass=attributes.get("needs_pass", False),
            page_count=attributes.get("page_count", 3),
            close=lambda: None,
        )

    return SimpleNamespace(open=open_document, Matrix=lambda *_args: None)


class ArchiveExpansionTests(unittest.TestCase):
    """A small archive can expand into a full disk, so the headers are read first."""

    def make_archive(self, root: Path, entries: dict[str, bytes]) -> Path:
        path = root / "archivio.zip"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, payload in entries.items():
                archive.writestr(name, payload)
        return path

    def test_a_highly_compressible_archive_is_refused(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            # 80 MB of zeros in a few kilobytes: the ratio is what gives it away.
            archive = self.make_archive(root, {"bomba.txt": b"\0" * (80 * 1024 * 1024)})
            self.assertLess(archive.stat().st_size, 1024 * 1024)
            with self.assertRaises(RuntimeError) as raised:
                engines.inspect_input(archive)
            self.assertIn("estrai", str(raised.exception).lower())

    def test_an_archive_that_expands_past_the_ceiling_is_refused(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            archive = self.make_archive(root, {"grande.bin": b"contenuto"})
            with patch.object(engines, "MAX_ARCHIVE_BYTES", 4):
                with self.assertRaises(RuntimeError) as raised:
                    engines.inspect_input(archive)
            self.assertIn("estrai", str(raised.exception).lower())

    def test_a_nested_archive_is_refused_instead_of_being_opened(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            inner = self.make_archive(root, {"nota.txt": b"testo"})
            outer = root / "esterno.zip"
            with zipfile.ZipFile(outer, "w") as archive:
                archive.write(inner, "interno.zip")
            with self.assertRaises(RuntimeError) as raised:
                engines.inspect_input(outer)
            self.assertIn("archivi", str(raised.exception))

    def test_too_many_entries_are_refused(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            archive = self.make_archive(
                root, {f"nota-{index}.txt": b"testo" for index in range(12)}
            )
            with patch.object(engines, "MAX_ARCHIVE_ENTRIES", 5):
                with self.assertRaises(RuntimeError) as raised:
                    engines.inspect_input(archive)
            self.assertIn("separatamente", str(raised.exception))

    def test_an_ordinary_archive_of_documents_is_accepted(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            archive = self.make_archive(
                root,
                {"nota.txt": b"un testo normale", "tabella.csv": b"a,b\n1,2\n"},
            )
            engines.inspect_input(archive)

    def test_a_truncated_archive_is_refused_with_a_readable_message(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            archive = self.make_archive(root, {"nota.txt": b"testo" * 500})
            data = archive.read_bytes()
            archive.write_bytes(data[: len(data) // 2])
            with self.assertRaises(RuntimeError) as raised:
                engines.inspect_input(archive)
            self.assertIn("archivio", str(raised.exception).lower())


class PdfGuardTests(unittest.TestCase):
    def test_a_password_protected_pdf_says_so_instead_of_failing_in_ocr(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            source = Path(raw_dir) / "contratto.pdf"
            source.write_bytes(b"%PDF-1.7\ncifrato")
            with patch.dict(sys.modules, {"fitz": fake_fitz(needs_pass=True)}):
                with self.assertRaises(RuntimeError) as raised:
                    engines.inspect_input(source)
        message = str(raised.exception)
        self.assertIn("protetto da password", message)
        self.assertIn("riprova", message.lower())

    def test_a_corrupt_pdf_is_refused_before_any_engine_is_chosen(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            source = Path(raw_dir) / "rotto.pdf"
            source.write_bytes(b"%PDF-1.7\n1 0 obj")
            broken = fake_fitz(error=ValueError("cannot open broken document"))
            with patch.dict(sys.modules, {"fitz": broken}):
                with self.assertRaises(RuntimeError) as raised:
                    engines.inspect_input(source)
        self.assertIn("danneggiato", str(raised.exception))

    def test_a_pdf_without_pages_is_refused(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            source = Path(raw_dir) / "vuoto.pdf"
            source.write_bytes(b"%PDF-1.7\n")
            with patch.dict(sys.modules, {"fitz": fake_fitz(page_count=0)}):
                with self.assertRaises(RuntimeError) as raised:
                    engines.inspect_input(source)
        self.assertIn("pagine", str(raised.exception))

    @unittest.skipUnless(HAS_PYMUPDF, "PyMuPDF fa parte del runtime installato")
    def test_a_real_encrypted_pdf_is_recognised(self):
        import fitz

        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            document = fitz.open()
            page = document.new_page()
            page.insert_text((72, 72), "riservato")
            protected = root / "riservato.pdf"
            document.save(
                str(protected),
                encryption=fitz.PDF_ENCRYPT_AES_256,
                owner_pw="proprietario",
                user_pw="segreto",
            )
            document.close()
            with self.assertRaises(RuntimeError) as raised:
                engines.inspect_input(protected)
            self.assertIn("protetto da password", str(raised.exception))

    @unittest.skipUnless(HAS_PYMUPDF, "PyMuPDF fa parte del runtime installato")
    def test_a_real_truncated_pdf_is_recognised(self):
        import fitz

        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            document = fitz.open()
            document.new_page().insert_text((72, 72), "testo")
            whole = root / "intero.pdf"
            document.save(str(whole))
            document.close()
            truncated = root / "troncato.pdf"
            truncated.write_bytes(whole.read_bytes()[:120])
            with self.assertRaises(RuntimeError):
                engines.inspect_input(truncated)


class LyingExtensionTests(unittest.TestCase):
    def test_an_extension_that_lies_about_the_content_is_refused(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            for name, payload in (
                ("finto.pdf", b"Questo non e' un PDF"),
                ("finto.png", b"%PDF-1.7 in realta un pdf"),
                ("finto.docx", b"testo semplice"),
                ("finto.zip", b"nemmeno un archivio"),
            ):
                source = root / name
                source.write_bytes(payload)
                with self.subTest(name=name):
                    with self.assertRaises(RuntimeError) as raised:
                        engines.inspect_input(source)
                    self.assertTrue(str(raised.exception).strip())

    def test_a_genuine_file_passes_the_signature_check(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            image = root / "scansione.png"
            image.write_bytes(b"\x89PNG\r\n\x1a\n" + b"dati")
            engines.inspect_input(image)
            # Formats with no unambiguous signature are left to their engine.
            audio = root / "intervista.mp3"
            audio.write_bytes(b"qualsiasi cosa")
            engines.inspect_input(audio)

    def test_a_file_that_disappeared_is_reported_and_not_a_traceback(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            with self.assertRaises(RuntimeError) as raised:
                engines.inspect_input(Path(raw_dir) / "mai-esistito.txt")
        self.assertIn("disponibile", str(raised.exception))


class EmptyResultTests(unittest.TestCase):
    """No engine may present an empty result as a finished job."""

    def test_markitdown_refuses_an_empty_conversion(self):
        class Empty:
            markdown = "   "
            text_content = ""

        module = SimpleNamespace(MarkItDown=lambda **_kwargs: SimpleNamespace(
            convert=lambda _path: Empty()
        ))
        with patch.dict(sys.modules, {"markitdown": module}):
            with self.assertRaises(RuntimeError) as raised:
                engines._markitdown_task({"path": "nota.docx"})
        self.assertIn("non è stato estratto alcun testo", str(raised.exception))

    def test_docling_refuses_an_empty_conversion(self):
        document = SimpleNamespace(export_to_markdown=lambda: "\n\n")
        converter = SimpleNamespace(
            convert=lambda _path: SimpleNamespace(document=document)
        )
        module = SimpleNamespace(DocumentConverter=lambda: converter)
        with patch.dict(
            sys.modules,
            {"docling": SimpleNamespace(), "docling.document_converter": module},
        ):
            with self.assertRaises(RuntimeError) as raised:
                engines._docling_task({"path": "relazione.pdf"})
        self.assertIn("Nessun testo", str(raised.exception))

    def test_privacy_refuses_a_file_without_text(self):
        with self.assertRaises(RuntimeError) as raised:
            engines._privacy_task({"text": "   \n\t", "output_format": "txt"})
        self.assertIn("non contiene testo", str(raised.exception))

    def test_paddleocr_refuses_a_blank_scan(self):
        # Pages were found, but nothing was read from them: the concatenated
        # output is empty, which used to be saved as a file of zero bytes.
        pipeline = SimpleNamespace(
            predict=lambda **_kwargs: iter(
                [SimpleNamespace(markdown={"markdown_texts": ""})]
            ),
            concatenate_markdown_pages=lambda _pages: {"markdown_texts": "   "},
        )
        with patch.object(engines, "_paddle_pipeline", return_value=pipeline):
            with self.assertRaises(RuntimeError) as raised:
                engines.convert_paddle(Path("scansione.pdf"), "markdown")
        self.assertIn("Nessun testo riconosciuto", str(raised.exception))

    def test_whisper_refuses_a_recording_without_speech(self):
        info = SimpleNamespace(language="it", language_probability=0.4)
        model = SimpleNamespace(transcribe=lambda *args, **kwargs: (iter([]), info))
        with patch.object(engines, "_whisper_model", return_value=model):
            with self.assertRaises(RuntimeError) as raised:
                engines.transcribe(Path("intervista.mp3"), "auto", "txt")
        self.assertIn("Nessun parlato", str(raised.exception))

    def test_glm_refuses_pages_it_could_not_read(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            source = Path(raw_dir) / "scansione.png"
            source.write_bytes(b"\x89PNG\r\n\x1a\n" + b"immagine")
            with patch.object(
                engines, "_ollama_request", return_value={"response": "  "}
            ):
                with self.assertRaises(RuntimeError) as raised:
                    engines.convert_glm(source)
        self.assertIn("non ha riconosciuto testo", str(raised.exception))

    def test_a_result_that_is_empty_once_converted_is_a_failure(self):
        # An image-only document survives as markdown and becomes nothing at all
        # as plain text: the last guard is what stops the empty file.
        result = engines.EngineResult(
            output="![scansione](pagina-1.png)",
            engine="finto",
            output_format="markdown",
        )
        with tempfile.TemporaryDirectory() as raw_dir:
            source = Path(raw_dir) / "nota.txt"
            source.write_text("contenuto", encoding="utf-8")
            with patch.object(engines, "convert_markitdown", return_value=result):
                with self.assertRaises(RuntimeError) as raised:
                    engines.process_file(source, "markitdown", "txt")
        self.assertIn("non ha prodotto testo", str(raised.exception))


class RequestLoggingTests(unittest.TestCase):
    """The names of the user's documents must not end up in the runtime log."""

    def test_the_access_log_is_disabled(self):
        # One line per request, query string included, appended to a file that
        # stays on disk: that is how document names were being recorded.
        self.assertTrue(logging.getLogger("uvicorn.access").disabled)

    def test_the_filename_travels_in_a_header_and_is_never_logged(self):
        client = local_client()
        result = engines.EngineResult(
            output="testo", engine="finto", output_format="txt"
        )
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        root = logging.getLogger()
        root.addHandler(handler)
        previous_level = root.level
        root.setLevel(logging.DEBUG)
        try:
            with patch.object(main, "process_file", return_value=result):
                response = client.post(
                    "/api/process-file",
                    params={"tool": "markitdown", "output_format": "txt"},
                    headers={"X-Local-Filename": "bilancio riservato.docx"},
                    content=b"contenuto",
                )
        finally:
            root.removeHandler(handler)
            root.setLevel(previous_level)

        self.assertEqual(response.status_code, 200)
        # The header decides the name of the result the user gets back...
        self.assertEqual(response.json()["filename"], "bilancio-riservato.txt")
        # ...and nothing about it reaches the log.
        self.assertNotIn("bilancio", stream.getvalue())
        self.assertNotIn("riservato", stream.getvalue())

    def test_the_query_parameter_still_works_for_a_client_that_uses_it(self):
        # The desktop core is updated separately: dropping the parameter here
        # would break the running app for the sake of a header.
        client = local_client()
        result = engines.EngineResult(
            output="testo", engine="finto", output_format="txt"
        )
        with patch.object(main, "process_file", return_value=result):
            response = client.post(
                "/api/process-file",
                params={
                    "tool": "markitdown",
                    "output_format": "txt",
                    "filename": "verbale.docx",
                },
                content=b"contenuto",
            )
        self.assertEqual(response.json()["filename"], "verbale.txt")


class SchemaSurfaceTests(unittest.TestCase):
    def test_the_schema_pages_are_not_served(self):
        # They answered without a token and enumerated every route of a server
        # that processes the user's documents.
        client = local_client()
        for path in ("/docs", "/redoc", "/openapi.json"):
            with self.subTest(path=path):
                self.assertEqual(client.get(path).status_code, 404)


if __name__ == "__main__":
    unittest.main()
