import unittest

from pydantic import ValidationError

from meeting_ai.models import ExtractionResult


def task(**overrides):
    value = {
        "title": "整理实验数据",
        "description": "整理实验数据。",
        "assignee": "小王",
        "deadline": "下周三前",
        "priority": None,
        "source_text": "小王下周三前整理实验数据",
        "confidence": "高",
        "needs_confirmation": False,
        "confirmation_reasons": [],
    }
    value.update(overrides)
    return value


def result_with(item):
    return {"tasks": [item], "pending_items": []}


class ExtractionResultTests(unittest.TestCase):
    def test_complete_task_is_valid(self):
        result = ExtractionResult.model_validate(result_with(task()))
        self.assertEqual(result.tasks[0].assignee, "小王")

    def test_missing_assignee_requires_confirmation(self):
        with self.assertRaises(ValidationError):
            ExtractionResult.model_validate(result_with(task(assignee=None)))

    def test_missing_deadline_requires_confirmation(self):
        with self.assertRaises(ValidationError):
            ExtractionResult.model_validate(result_with(task(deadline=None)))

    def test_missing_fields_are_valid_when_confirmation_is_explained(self):
        result = ExtractionResult.model_validate(
            result_with(
                task(
                    assignee=None,
                    deadline=None,
                    needs_confirmation=True,
                    confirmation_reasons=["负责人未明确", "截止时间未明确"],
                )
            )
        )
        self.assertTrue(result.tasks[0].needs_confirmation)

    def test_confirmation_requires_reasons(self):
        with self.assertRaises(ValidationError):
            ExtractionResult.model_validate(result_with(task(needs_confirmation=True)))

    def test_priority_must_use_allowed_values(self):
        with self.assertRaises(ValidationError):
            ExtractionResult.model_validate(result_with(task(priority="待确认")))

    def test_confidence_must_use_allowed_values(self):
        with self.assertRaises(ValidationError):
            ExtractionResult.model_validate(result_with(task(confidence="非常高")))

    def test_unknown_task_fields_are_rejected(self):
        with self.assertRaises(ValidationError):
            ExtractionResult.model_validate(result_with(task(invented_field="不应存在")))

    def test_pending_item_requires_reason_and_source(self):
        with self.assertRaises(ValidationError):
            ExtractionResult.model_validate(
                {
                    "tasks": [],
                    "pending_items": [
                        {
                            "description": "考虑增加数据分析模块",
                            "source_text": "",
                            "reason": "",
                        }
                    ],
                }
            )

    def test_empty_result_is_valid(self):
        result = ExtractionResult.model_validate({"tasks": [], "pending_items": []})
        self.assertEqual(result.tasks, [])


if __name__ == "__main__":
    unittest.main()
