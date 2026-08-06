#!/usr/bin/env python3
"""Run PDFMathTranslate while exporting machine-readable progress snapshots."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from babeldoc.assets.assets import warmup
from pdf2zh_next.config.model import (
    PDFSettings,
    SettingsModel,
    TranslationSettings,
)
from pdf2zh_next.config.translate_engine_model import OllamaSettings
from pdf2zh_next.high_level import do_translate_async_stream


STAGE_LABELS = {
    "Parse PDF and Create Intermediate Representation": "Lettura e analisi del PDF",
    "DetectScannedFile": "Rilevamento delle pagine scansionate",
    "Parse Page Layout": "Analisi dell’impaginazione",
    "Parse Table": "Analisi delle tabelle",
    "Parse Paragraphs": "Riconoscimento dei paragrafi",
    "Parse Formulas and Styles": "Analisi di formule e stili",
    "Automatic Term Extraction": "Preparazione della terminologia",
    "Translate Paragraphs": "Traduzione dei paragrafi",
    "Typesetting": "Ricostruzione dell’impaginazione",
    "Add Fonts": "Inserimento dei caratteri",
    "Generate drawing instructions": "Ricostruzione di grafica e testo",
    "Subset font": "Ottimizzazione dei caratteri",
    "Save PDF": "Salvataggio del PDF",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Traduzione PDF locale con avanzamento JSON."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--progress-file", type=Path, required=True)
    parser.add_argument("--ollama-host", required=True)
    parser.add_argument("--ollama-model", required=True)
    parser.add_argument("--lang-in", required=True)
    parser.add_argument("--lang-out", required=True)
    parser.add_argument("--qps", type=int, default=1)
    parser.add_argument("--pool-max-workers", type=int, default=1)
    parser.add_argument("--custom-system-prompt")
    parser.add_argument("--no-auto-extract-glossary", action="store_true")
    parser.add_argument("--auto-enable-ocr-workaround", action="store_true")
    parser.add_argument("--watermark-output-mode", default="no_watermark")
    output_group = parser.add_mutually_exclusive_group(required=True)
    output_group.add_argument("--no-dual", action="store_true")
    output_group.add_argument("--no-mono", action="store_true")
    return parser.parse_args()


class ProgressWriter:
    def __init__(self, destination: Path):
        self.destination = destination
        self.destination.parent.mkdir(parents=True, exist_ok=True)

    def write(self, payload: dict[str, Any]) -> None:
        payload = {**payload, "updated_at": time.time()}
        temporary = self.destination.with_name(
            f".{self.destination.name}.{os.getpid()}.tmp"
        )
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(temporary, self.destination)
        print(
            "LOCAL_AI_PROGRESS " + json.dumps(payload, ensure_ascii=False),
            flush=True,
        )


def progress_payload(event: dict[str, Any]) -> dict[str, Any] | None:
    event_type = event.get("type")
    if event_type not in {"progress_start", "progress_update", "progress_end"}:
        return None
    stage = str(event.get("stage", "Elaborazione del PDF"))
    overall = max(0.0, min(100.0, float(event.get("overall_progress", 0.0))))
    # Reserve the first 5% for upload/warmup and the last 2% for handing the
    # completed PDF back to the browser.
    app_progress = min(98.0, 5.0 + overall * 0.93)
    return {
        "state": "processing",
        "progress": round(app_progress, 2),
        "stage": stage,
        "stage_label": STAGE_LABELS.get(stage, stage),
        "stage_progress": round(float(event.get("stage_progress", 0.0)), 2),
        "stage_current": int(event.get("stage_current", 0)),
        "stage_total": int(event.get("stage_total", 0)),
        "part_index": int(event.get("part_index", 1)),
        "total_parts": int(event.get("total_parts", 1)),
    }


async def run(args: argparse.Namespace) -> int:
    writer = ProgressWriter(args.progress_file)
    writer.write(
        {
            "state": "preparing",
            "progress": 4.0,
            "stage": "Warmup",
            "stage_label": "Preparazione del motore locale",
            "stage_progress": 0.0,
            "stage_current": 0,
            "stage_total": 0,
            "part_index": 1,
            "total_parts": 1,
        }
    )
    warmup()

    settings = SettingsModel(
        report_interval=0.25,
        translation=TranslationSettings(
            lang_in=args.lang_in,
            lang_out=args.lang_out,
            output=str(args.output),
            qps=args.qps,
            pool_max_workers=args.pool_max_workers,
            custom_system_prompt=args.custom_system_prompt,
            no_auto_extract_glossary=args.no_auto_extract_glossary,
        ),
        pdf=PDFSettings(
            no_dual=args.no_dual,
            no_mono=args.no_mono,
            watermark_output_mode=args.watermark_output_mode,
            auto_enable_ocr_workaround=args.auto_enable_ocr_workaround,
        ),
        translate_engine_settings=OllamaSettings(
            ollama_host=args.ollama_host,
            ollama_model=args.ollama_model,
        ),
    )

    saw_finish = False
    try:
        async for event in do_translate_async_stream(settings, args.input):
            if payload := progress_payload(event):
                writer.write(payload)
            elif event.get("type") == "finish":
                saw_finish = True
                writer.write(
                    {
                        "state": "finishing",
                        "progress": 99.0,
                        "stage": "Finish",
                        "stage_label": "Preparazione del download",
                        "stage_progress": 100.0,
                        "stage_current": 1,
                        "stage_total": 1,
                        "part_index": 1,
                        "total_parts": 1,
                    }
                )
                break
            elif event.get("type") == "error":
                raise RuntimeError(str(event.get("error", "Errore di traduzione")))
    except Exception as exc:
        writer.write(
            {
                "state": "error",
                "progress": 0.0,
                "stage": "Error",
                "stage_label": "Traduzione non riuscita",
                "error": f"{type(exc).__name__}: {exc}",
            }
        )
        logging.exception("PDF translation failed")
        return 1
    return 0 if saw_finish else 1


def main() -> int:
    logging.basicConfig(level=logging.INFO)
    return asyncio.run(run(parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
