import re
import unicodedata


def normalize_word(value: str) -> str:
    word = " ".join(unicodedata.normalize("NFKC", value).replace("’", "'").lower().split())
    if not re.fullmatch(r"[a-z]+(?:[-' ][a-z]+)*", word) or len(word) > 80 or len(word.split()) > 5:
        raise ValueError("Use an English word or short phrase")
    return word
