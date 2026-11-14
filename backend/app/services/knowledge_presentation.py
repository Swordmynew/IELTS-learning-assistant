"""Read-only display metadata for app-authored labels; never rewrite source snapshots."""

import re

CRITERION_KEYS = {
    "task_achievement": "ui.taskResponse",
    "coherence_cohesion": "ui.coherenceAndCohesion",
    "lexical_resource": "ui.lexicalResource",
    "grammar_accuracy": "ui.grammaticalRangeAndAccuracy",
}
FIELD_KEYS = {
    "题目": "prompt", "原文": "passage", "最近作答": "latestAnswer", "作答": "answer",
    "参考答案": "referenceAnswer", "原有解析": "explanation", "最近结果": "result",
    "单词": "word", "选择的释义": "selectedMeaning", "正确释义": "correctMeaning",
    "原句": "quote", "AI 反馈": "feedback", "目标": "goal",
    "单词或短语": "word", "释义": "meaning", "例句": "example", "备注": "note",
    "原用词": "originalForm", "学习要点": "learningPoint",
}
FORMATS = {
    "question": [
        ["题目", "原文", "最近作答", "参考答案", "原有解析", "最近结果"],
        ["题目", "原文", "最近作答", "参考答案", "原有解析"],
        ["题目", "作答", "参考答案"],
    ],
    "word": [
        ["单词", "选择的释义", "正确释义", "最近结果"],
        ["单词", "选择的释义", "正确释义"],
        ["单词", "作答", "正确释义"],
        ["单词或短语", "释义", "例句", "备注"],
    ],
    "writing": [["原句", "AI 反馈", "目标"]],
}


def knowledge_display(source_key: str, data: dict) -> dict:
    if data.get("source_kind") in {"manual", "bookmark"} or data.get("provenance") in {
        "user-authored-note", "user-self-review", "practice-excerpt", "learner-writing-excerpt",
        "ai-answer-bookmark", "document-excerpt",
    }:
        return {}
    kind = source_key.split(":", 1)[0]
    result = {}
    title = data.get("title", "")
    if kind == "writing" and title in CRITERION_KEYS:
        result["title_message_key"] = CRITERION_KEYS[title]
    elif kind == "assessment" and title in {"历史写作反馈", "写作反馈"}:
        result["title_message_key"] = "system.writing.legacyTitle" if title == "历史写作反馈" else "system.writing.feedbackTitle"
    content = data.get("content", "")
    # Only recognise an entire known format with unambiguous label boundaries.
    # A quoted passage containing the same labels remains verbatim, not guessed at.
    labels = re.findall(r"^(" + "|".join(map(re.escape, FIELD_KEYS)) + r")：", content, re.MULTILINE)
    formats = list(FORMATS.get(kind, []))
    word_fields = ["单词或短语", "释义", "例句", "备注"]
    context_fields = ["原句", "原用词", "学习要点"]
    if kind == "word" and labels[:4] == word_fields:
        context_count, remainder = divmod(len(labels) - 4, 3)
        if context_count and not remainder and labels[4:] == context_fields * context_count:
            formats.append(word_fields + context_fields * context_count)
    for fields in formats:
        if labels != fields:
            continue
        pattern = r"\n".join(re.escape(field) + r"：([\s\S]*?)" for field in fields)
        match = re.fullmatch(pattern, content)
        if not match:
            continue
        values = match.groups()
        result["display_fields"] = [
            {"label_key": f"system.record.{FIELD_KEYS[field]}", "value": value,
             **({"value_key": {"答对": "system.record.correct", "答错": "system.record.incorrect"}[value]}
                if field == "最近结果" and value in {"答对", "答错"} else {})}
            for field, value in zip(fields, values, strict=True)
        ]
        break
    return result
