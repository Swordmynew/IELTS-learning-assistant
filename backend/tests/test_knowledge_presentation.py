from copy import deepcopy

import pytest

from app.db import CoachRecord
from app.services.knowledge_presentation import knowledge_display
from app.services.personal_knowledge import knowledge_view


def test_writing_labels_are_read_only_metadata_not_translated_source_text():
    data = {"title": "grammar_accuracy", "content": "原句：My original sentence.\nAI 反馈：保留模型返回的内容。\n目标：Keep the model's goal."}
    before = deepcopy(data)
    view = knowledge_display("writing:version:issue", data)
    assert view["title_message_key"] == "ui.grammaticalRangeAndAccuracy"
    assert [field["value"] for field in view["display_fields"]] == ["My original sentence.", "保留模型返回的内容。", "Keep the model's goal."]
    assert data == before


@pytest.mark.parametrize("source_kind", ["manual", "bookmark"])
def test_user_text_and_bookmarked_content_never_gain_generated_translations(source_kind):
    data = {"source_kind": source_kind, "title": "grammar_accuracy", "content": "原句：Keep this.\nAI 反馈：Do not change.\n目标：Keep this too."}
    assert knowledge_display("writing:version:issue", data) == {}


def test_self_review_notes_are_never_parsed_as_system_wrappers():
    data = {"provenance": "user-self-review", "content": "单词：benefit\n作答：my own note\n正确释义：leave it alone"}
    assert knowledge_display("word:benefit", data) == {}


def test_ambiguous_embedded_labels_are_left_verbatim():
    data = {"content": "原句：A quotation with a label:\n目标：not a system label\nAI 反馈：Feedback\n目标：Actual goal"}
    assert "display_fields" not in knowledge_display("writing:version:issue", data)


def test_question_fields_preserve_multiline_learning_material_and_result_key():
    data = {"content": "题目：A question\n原文：Line one\nLine two\n最近作答：Student answer\n参考答案：Reference\n原有解析：Original explanation\n最近结果：答错"}
    fields = knowledge_display("question:id", data)["display_fields"]
    assert fields[1]["value"] == "Line one\nLine two"
    assert fields[-1]["value"] == "答错"
    assert fields[-1]["value_key"] == "system.record.incorrect"


def test_vocabulary_context_labels_preserve_each_original_quote_and_model_explanation():
    content = "单词或短语：benefit\n释义：益处\n例句：An example.\n备注：My note\n原句：Quote one\n原用词：benifit\n学习要点：原始模型反馈\n原句：Quote two\n原用词：benefits\n学习要点：Original feedback"
    fields = knowledge_display("word:benefit", {"content": content})["display_fields"]
    assert len(fields) == 10
    assert [field["value"] for field in fields[4:]] == ["Quote one", "benifit", "原始模型反馈", "Quote two", "benefits", "Original feedback"]
    assert fields[5]["label_key"] == "system.record.originalForm"
    assert fields[6]["label_key"] == "system.record.learningPoint"


def test_ambiguous_vocabulary_context_labels_are_not_parsed():
    content = "单词或短语：benefit\n释义：益处\n例句：An example.\n备注：My note\n原句：Quote\n学习要点：Embedded label\n原用词：benefits\n学习要点：Feedback"
    assert "display_fields" not in knowledge_display("word:benefit", {"content": content})


def test_knowledge_view_keeps_payload_and_merged_snapshots_unchanged():
    data = {"title": "My renamed title", "content": "Original content", "category": "writing", "module": "writing",
            "merged_records": {"writing:old:issue": {"title": "lexical_resource", "content": "原句：A quote\nAI 反馈：An explanation\n目标：A goal", "source_link": "/writing"}}}
    row = CoachRecord(id="synthetic", source_key="writing:version:issue", payload=deepcopy(data))
    view = knowledge_view(row)
    assert "title_message_key" not in view
    assert view["merged_records"]["writing:old:issue"]["title_message_key"] == "ui.lexicalResource"
    assert view["merged_records"]["writing:old:issue"]["content"] == data["merged_records"]["writing:old:issue"]["content"]
    assert row.payload == data
