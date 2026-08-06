from __future__ import annotations

import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from backend.app import engines


class EngineConcurrencyTests(unittest.TestCase):
    def measure_limit(self, tool: str, count: int) -> int:
        active = 0
        maximum = 0
        state_lock = threading.Lock()
        barrier = threading.Barrier(count)

        def fake_conversion(*_args, **_kwargs):
            nonlocal active, maximum
            with state_lock:
                active += 1
                maximum = max(maximum, active)
            time.sleep(0.08)
            with state_lock:
                active -= 1
            return engines.EngineResult(
                output="ok",
                engine="test",
                output_format="markdown",
            )

        function_name = {
            "markitdown": "convert_markitdown",
            "paddleocr": "convert_paddle",
        }[tool]
        original = getattr(engines, function_name)
        setattr(engines, function_name, fake_conversion)
        try:
            with tempfile.TemporaryDirectory() as raw_dir:
                root = Path(raw_dir)
                paths = []
                for index in range(count):
                    path = root / f"fixture-{index}.txt"
                    path.write_text("fixture", encoding="utf-8")
                    paths.append(path)

                def process(path: Path):
                    barrier.wait()
                    return engines.process_file(path, tool, "markdown")

                with ThreadPoolExecutor(max_workers=count) as executor:
                    list(executor.map(process, paths))
        finally:
            setattr(engines, function_name, original)
        return maximum

    def test_markitdown_allows_four_parallel_jobs(self):
        self.assertEqual(self.measure_limit("markitdown", 6), 4)

    def test_paddleocr_stays_single_threaded(self):
        self.assertEqual(self.measure_limit("paddleocr", 3), 1)


if __name__ == "__main__":
    unittest.main()
