import os
from pathlib import Path
from typing import BinaryIO

from openai import OpenAI

from .models import ExtractionResult
from .prompt import SYSTEM_PROMPT


class MeetingAIService:
    """Calls OpenAI from the backend. Never instantiate this in frontend code."""

    def __init__(self, client: OpenAI | None = None):
        self.client = client or OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        self.transcription_model = os.getenv("OPENAI_TRANSCRIPTION_MODEL", "gpt-transcribe")
        self.task_model = os.getenv("OPENAI_TASK_MODEL", "gpt-4o-mini")

    def transcribe(self, audio: BinaryIO, filename: str) -> str:
        suffix = Path(filename).suffix.lower()
        allowed = {".flac", ".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".ogg", ".wav", ".webm"}
        if suffix not in allowed:
            raise ValueError(f"不支持的录音格式: {suffix or '无扩展名'}")

        # The SDK needs an extension-bearing filename to identify the media type.
        audio.name = filename
        result = self.client.audio.transcriptions.create(
            model=self.transcription_model,
            file=audio,
            language="zh",
            prompt="课程小组项目会议，可能包含前端、后端、数据库、API、JSON等术语。",
        )
        text = result.text.strip()
        if not text:
            raise ValueError("语音转写结果为空")
        return text

    def extract_tasks(self, transcript: str) -> ExtractionResult:
        transcript = transcript.strip()
        if not transcript:
            raise ValueError("会议纪要不能为空")

        response = self.client.responses.parse(
            model=self.task_model,
            input=[
                {"role": "developer", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"会议纪要：\n{transcript}"},
            ],
            text_format=ExtractionResult,
        )
        if response.output_parsed is None:
            raise ValueError("模型未返回可解析的任务结果")
        return response.output_parsed
