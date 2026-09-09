from flask import Blueprint, jsonify, request
from pydantic import ValidationError

from .service import MeetingAIService


meeting_ai_bp = Blueprint("meeting_ai", __name__, url_prefix="/api/meetings")


def get_service() -> MeetingAIService:
    return MeetingAIService()


@meeting_ai_bp.post("/transcribe")
def transcribe_audio():
    audio = request.files.get("audio")
    if audio is None or not audio.filename:
        return jsonify({"error": "请上传 audio 文件"}), 400

    try:
        transcript = get_service().transcribe(audio.stream, audio.filename)
        return jsonify({"transcript": transcript})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        return jsonify({"error": "语音转写服务暂时不可用"}), 502


@meeting_ai_bp.post("/<int:meeting_id>/extract-tasks")
def extract_tasks(meeting_id: int):
    data = request.get_json(silent=True) or {}
    transcript = data.get("transcript", "")
    try:
        result = get_service().extract_tasks(transcript)
        return jsonify({"meeting_id": meeting_id, **result.model_dump()})
    except (ValueError, ValidationError) as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        return jsonify({"error": "任务提取服务暂时不可用"}), 502


# 正式任务的确认和入库应由后端成员在业务层实现。
# 此模块只生成草稿，不直接写正式任务表。
