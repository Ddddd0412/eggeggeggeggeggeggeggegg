from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TaskDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    assignee: str | None
    deadline: str | None
    priority: Literal["高", "中", "低"] | None
    source_text: str = Field(min_length=1)
    confidence: Literal["高", "中", "低"]
    needs_confirmation: bool
    confirmation_reasons: list[str]

    @model_validator(mode="after")
    def check_confirmation_consistency(self):
        missing = []
        if self.assignee is None:
            missing.append("负责人未明确")
        if self.deadline is None:
            missing.append("截止时间未明确")

        if missing and not self.needs_confirmation:
            raise ValueError("负责人或截止时间为空时必须要求人工确认")
        if self.needs_confirmation and not self.confirmation_reasons:
            raise ValueError("需要人工确认时必须给出 confirmation_reasons")
        return self


class PendingItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = Field(min_length=1)
    source_text: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class ExtractionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tasks: list[TaskDraft]
    pending_items: list[PendingItem]
