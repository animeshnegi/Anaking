"""Helpers for uploaded narration clips."""

from __future__ import annotations


def clip_duration(path: str) -> float | None:
    """Length of an audio file in seconds, or None if it cannot be read.

    Uses mutagen when available (mp3 / m4a / ogg / wav / webm). The explainer only needs
    this for its progress bar; when unknown the browser reports the length on load.
    """
    try:
        import mutagen
        audio = mutagen.File(path)
        if audio is not None and getattr(audio, "info", None) is not None:
            length = float(audio.info.length or 0)
            return round(length, 2) if length > 0 else None
    except Exception:  # pragma: no cover - any parse failure is non-fatal
        pass
    return None
