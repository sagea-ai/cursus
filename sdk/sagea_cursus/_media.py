"""Image encoding for log_image — file/bytes/PIL/numpy into PNG/JPEG/WEBP.

No hard dependencies: PIL and numpy are lazy optional imports with clear
errors. Pure functions, unit-testable without a server.
"""

from __future__ import annotations

from os import PathLike
from pathlib import Path
from typing import Any

MAX_BYTES = 5 * 1024 * 1024


def sniff_mime(data: bytes) -> str | None:
    """Magic-byte sniffing for the three server-accepted types."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def encode_image(image: Any) -> tuple[bytes, str]:
    """Return (bytes, mime) or raise ValueError/TypeError (caller warns)."""
    if isinstance(image, (str, PathLike)):
        data = Path(image).read_bytes()
        mime = sniff_mime(data)
        if mime is None:
            raise ValueError(f"unrecognized image format: {image}")
        return data, mime
    if isinstance(image, (bytes, bytearray)):
        data = bytes(image)
        mime = sniff_mime(data)
        if mime is None:
            raise ValueError("bytes are not PNG/JPEG/WEBP")
        return data, mime
    image_type = type(image).__module__ + "." + type(image).__name__
    if image_type == "PIL.Image.Image":
        from io import BytesIO

        buf = BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue(), "image/png"
    if "numpy" in image_type and hasattr(image, "dtype"):
        try:
            from PIL.Image import fromarray
        except ImportError:
            raise ValueError("numpy arrays need pillow to encode (pip install pillow)") from None
        from io import BytesIO

        buf = BytesIO()
        fromarray(image).save(buf, format="PNG")
        return buf.getvalue(), "image/png"
    raise TypeError(f"log_image() takes a path, bytes, PIL Image, or numpy array; got {image_type}")
