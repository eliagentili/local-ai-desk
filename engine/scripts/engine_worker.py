"""Answer one engine's tasks in a process the local server can terminate.

MarkItDown, Docling and the Privacy Filter each do their work in a single
blocking call. Run inside the server they cannot be interrupted: a cancelled job
would keep a core busy and its engine slot held until the call returned on its
own, so the interface would say "annullato" while the machine kept working. Here
the server writes one JSON request per line on stdin, reads one JSON reply per
line on stdout, and stopping a job means terminating this process.

The process is reused for as many jobs as it is given, so that loading the
Privacy Filter checkpoint or building Docling's converter is paid once instead of
once per job.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, TextIO

# Started as a plain script, so the package the tasks live in has to be findable.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _protect_reply_stream() -> TextIO:
    """Keep stdout for the protocol and send everything else to the log.

    Conversion libraries print progress and warnings on stdout; a single such
    line between two replies would leave the server reading a reply that is not
    one. So the reply keeps a private copy of the stream and file descriptor 1 is
    pointed at stderr, which the desktop app already collects.
    """
    try:
        replies = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
        os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
        return replies
    except (OSError, ValueError, AttributeError):
        return sys.stdout


def _failure_message(exc: Exception) -> str:
    # The tasks raise RuntimeError with a message written for the user; anything
    # else is unexpected, and the type name is what makes it reportable.
    if isinstance(exc, RuntimeError) and str(exc).strip():
        return str(exc)
    return (
        "Il motore locale non è riuscito a elaborare questo file "
        f"({type(exc).__name__}): riprova, oppure converti il file in un altro "
        "formato e riprova."
    )


def main() -> int:
    if len(sys.argv) < 2:
        return 2
    engine = sys.argv[1]
    replies = _protect_reply_stream()

    from backend.app.engines import run_worker_task

    for line in sys.stdin:
        request = line.strip()
        if not request:
            continue
        reply: dict[str, Any]
        try:
            reply = {"ok": True, "result": run_worker_task(engine, json.loads(request))}
        except Exception as exc:  # reported to the server instead of crashing
            reply = {"ok": False, "error": _failure_message(exc)}
        replies.write(json.dumps(reply, ensure_ascii=False) + "\n")
        replies.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
