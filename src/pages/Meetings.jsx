import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createMeeting,
  extractTasks,
  getMeetings,
} from "../api/api";

function Meetings() {
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [content, setContent] = useState("");
  const [meetings, setMeetings] = useState([]);

  // 录音状态
  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioBlob, setAudioBlob] = useState(null);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioUrlRef = useRef("");

  useEffect(() => {
    loadMeetings();

    return () => {
      clearTimer();
      stopTracks();

      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, []);

  const loadMeetings = async () => {
    try {
      const data = await getMeetings();
      setMeetings(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("获取会议记录失败：", error);
    }
  };

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopTracks = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const clearOldAudioUrl = () => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = "";
    }
  };

  // 优先选择 Chrome / Edge 最稳定的 WebM + Opus
  const getMimeType = () => {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ];

    return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("当前浏览器不支持麦克风录音。");
      return;
    }

    try {
      // 清除上一次录音
      clearOldAudioUrl();
      setAudioUrl("");
      setAudioBlob(null);
      setRecordTime(0);
      chunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      streamRef.current = stream;

      const mimeType = getMimeType();

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        console.error("MediaRecorder 错误：", event);
      };

      recorder.onstop = () => {
        const actualType =
          chunksRef.current[0]?.type ||
          recorder.mimeType ||
          "audio/webm";

        // 直接用 MediaRecorder 产生的数据块组成 Blob，
        // 不再额外 requestData，避免部分浏览器产生损坏文件。
        const blob = new Blob(chunksRef.current, {
          type: actualType,
        });

        console.log("录音格式：", actualType);
        console.log("录音大小：", blob.size);

        stopTracks();

        if (blob.size === 0) {
          alert("没有录制到有效音频，请重新尝试。");
          return;
        }

        clearOldAudioUrl();

        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;

        setAudioBlob(blob);
        setAudioUrl(url);
      };

      // 每 1000ms 输出一个完整音频数据块
      recorder.start(1000);

      setIsRecording(true);
      setRecordTime(0);

      timerRef.current = setInterval(() => {
        setRecordTime((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error("开始录音失败：", error);
      stopTracks();

      if (error?.name === "NotAllowedError") {
        alert("请允许浏览器使用麦克风。");
      } else {
        alert("无法开始录音，请检查麦克风和浏览器权限。");
      }
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state === "inactive") {
      return;
    }

    clearTimer();
    setIsRecording(false);

    // 直接 stop。stop 会自动触发最后一次 dataavailable。
    recorder.stop();
  };

  const deleteRecording = () => {
    clearTimer();

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    stopTracks();
    clearOldAudioUrl();

    setAudioUrl("");
    setAudioBlob(null);
    setRecordTime(0);
    setIsRecording(false);
    chunksRef.current = [];
  };

  const handleAudioError = (event) => {
    const audio = event.currentTarget;
    const error = audio.error;

    console.error("音频播放加载失败：", {
      code: error?.code,
      message: error?.message,
      src: audio.currentSrc,
    });

    alert(
      "录音已经生成，但浏览器无法解码该音频。请刷新页面后重新录制一次；建议使用最新版 Edge 或 Chrome。"
    );
  };

  // 当前仍为模拟语音转文字
  const handleTranscribe = () => {
    if (!audioBlob) {
      alert("请先完成录音。");
      return;
    }

    setContent(
      "下周三前，小王整理实验数据，小李完成展示PPT，大家周五讨论测试结果。"
    );

    alert("当前为模拟语音转文字，后续可连接后端语音识别接口。");
  };

  const formatTime = (seconds) => {
    const minute = String(Math.floor(seconds / 60)).padStart(2, "0");
    const second = String(seconds % 60).padStart(2, "0");
    return `${minute}:${second}`;
  };

  const handleSaveMeeting = async () => {
    if (!title.trim()) {
      alert("请输入会议标题。");
      return;
    }

    if (!date) {
      alert("请选择会议日期。");
      return;
    }

    if (!content.trim()) {
      alert("请输入会议纪要。");
      return;
    }

    try {
      await createMeeting({
        title: title.trim(),
        date,
        content: content.trim(),
      });

      alert("会议纪要保存成功。");
      await loadMeetings();
    } catch (error) {
      console.error(error);
      alert("会议纪要保存失败。");
    }
  };

  const handleExtractTasks = async () => {
    if (!content.trim()) {
      alert("请先输入或生成会议纪要内容。");
      return;
    }

    try {
      await extractTasks({
        title: title.trim(),
        date,
        content: content.trim(),
      });

      navigate("/ai-tasks");
    } catch (error) {
      console.error(error);
      alert("AI任务提取失败。");
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>会议纪要</h1>
          <p>录入会议内容，并通过 AI 自动提取任务草稿。</p>
        </div>
      </div>

      <div className="content-card">
        <div className="form-grid">
          <div className="form-group">
            <label>会议标题</label>
            <input
              type="text"
              placeholder="例如：课程项目第3次小组会议"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>会议日期</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>

        <div className="record-section">
          <div className="record-header">
            <div>
              <h3>会议录音</h3>
              <p>可以直接使用电脑麦克风录制会议内容。</p>
            </div>

            <span
              className={
                isRecording
                  ? "record-status recording"
                  : "record-status"
              }
            >
              {isRecording
                ? `正在录音 ${formatTime(recordTime)}`
                : audioBlob
                ? `录音完成 ${formatTime(recordTime)}`
                : "未录音"}
            </span>
          </div>

          <div className="record-actions">
            {!isRecording ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={startRecording}
              >
                {audioBlob ? "重新录音" : "开始录音"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-danger"
                onClick={stopRecording}
              >
                停止录音
              </button>
            )}

            {audioBlob && !isRecording && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleTranscribe}
                >
                  语音转文字
                </button>

                <button
                  type="button"
                  className="btn btn-outline-danger"
                  onClick={deleteRecording}
                >
                  删除录音
                </button>
              </>
            )}
          </div>

          {audioUrl && (
            <div className="audio-preview">
              <p>录音预览</p>

              <audio
                key={audioUrl}
                controls
                preload="auto"
                className="audio-player"
                onError={handleAudioError}
              >
                <source
                  src={audioUrl}
                  type={audioBlob?.type || "audio/webm"}
                />
                当前浏览器不支持音频播放。
              </audio>
            </div>
          )}
        </div>

        <div className="form-group">
          <label>会议纪要</label>

          <textarea
            rows="10"
            placeholder="请输入会议纪要，例如：下周三前，小王整理实验数据，小李完成展示PPT，大家周五讨论测试结果。"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />

          <div className="form-tip">
            可以手动输入会议纪要，也可以先录音，再点击“语音转文字”。
          </div>
        </div>

        <div className="page-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSaveMeeting}
          >
            保存会议纪要
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleExtractTasks}
          >
            AI提取任务
          </button>
        </div>
      </div>

      <div className="content-card">
        <div className="section-title">
          <h2>最近会议记录</h2>
        </div>

        {meetings.length === 0 ? (
          <div className="empty-state">暂无会议记录</div>
        ) : (
          <div className="meeting-list">
            {meetings.map((meeting) => (
              <div
                className="meeting-item"
                key={meeting.id}
              >
                <div>
                  <h3>{meeting.title}</h3>
                  <p>{meeting.content}</p>
                </div>

                <span>{meeting.date}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Meetings;
