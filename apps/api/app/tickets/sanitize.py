"""
Everything that came from the end user's browser (transcript, console text, URLs, click labels) is
untrusted data. These helpers make it safe to embed in a ticket and in an LLM prompt:
strip control and invisible/bidi characters, truncate, and render multi-line text only inside a code
fence so it can never become headings, links, images or instructions in the tracker.
"""

import re
from urllib.parse import urlsplit, urlunsplit

# C0/C1 controls except \t and \n.
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")
# Zero-width, bidi override/isolate ("Trojan source") and BOM characters.
_INVISIBLE = re.compile("[​-‏‪-‮⁠-⁤⁦-⁩﻿]")
_BACKTICKS = re.compile(r"`+")


def clean_block(value: object, max_len: int) -> str:
    """Multi-line text: normalise newlines, drop control/invisible chars, truncate."""
    text = value if isinstance(value, str) else ("" if value is None else str(value))
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _INVISIBLE.sub("", _CONTROL.sub("", text)).strip()
    return text if len(text) <= max_len else text[: max(max_len - 1, 0)].rstrip() + "…"


def clean_line(value: object, max_len: int) -> str:
    """Single-line text: like clean_block, with all whitespace runs collapsed."""
    text = value if isinstance(value, str) else ("" if value is None else str(value))
    text = _INVISIBLE.sub("", _CONTROL.sub(" ", text))
    text = " ".join(text.split())
    return text if len(text) <= max_len else text[: max(max_len - 1, 0)].rstrip() + "…"


def clean_url(value: object, max_len: int = 500) -> str:
    """http(s) URLs only, fragment dropped. Anything else (javascript:, data:, garbage) becomes ''."""
    text = clean_line(value, 2048)
    try:
        parts = urlsplit(text)
    except ValueError:
        return ""
    if parts.scheme not in ("http", "https") or not parts.netloc or " " in text:
        return ""
    return clean_line(urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, "")), max_len)


def defang_markdown(value: object, max_len: int) -> str:
    """
    Single-line free text (e.g. LLM output derived from untrusted input) rendered as plain prose:
    brackets, angle brackets and backticks are escaped so it can't form links, images, HTML or code.
    """
    text = clean_line(value, max_len)
    for ch in ("\\", "`", "[", "]", "<", ">"):
        text = text.replace(ch, "\\" + ch)
    return text


def fenced(value: object, max_len: int, info: str = "text") -> str:
    """Untrusted multi-line text inside a code fence longer than any backtick run it contains."""
    text = clean_block(value, max_len)
    longest = max((len(m) for m in _BACKTICKS.findall(text)), default=0)
    fence = "`" * max(3, longest + 1)
    return f"{fence}{info}\n{text}\n{fence}"
