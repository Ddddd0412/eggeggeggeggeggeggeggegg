import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createMeeting,
  extractTasks,
  getMeetings,
  transcribeMeetingFiles,
} from '../api/api';

export default function Meetings() {
  const navigate = useNavigate();

  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    title: '',
    date: today,
    content: '',
  });

  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);

  // 上传文件和录音文件统一放在这里
  const [meetingFiles, setMeetingFiles] = useState([]);

  // 录音相关状态
  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => {
    loadMeetings();

    return () => {
      clearRecordingTimer();
      stopMicrophone();

      // 页面关闭时释放本地音频预览地址
      meetingFiles.forEach((item) => {
        if (item.url) {
          URL.revokeObjectURL(item.url);
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMeetings = async () => {
    try {
      const data = await getMeetings();
      setMeetings(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('获取会议记录失败：', error);
    }
  };

  const updateForm = (key, value) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const createFileId = (name) => {
    if (window.crypto?.randomUUID) {
      return `${Date.now()}-${crypto.randomUUID()}-${name}`;
    }

    return `${Date.now()}-${Math.random()}-${name}`;
  };

  const clearRecordingTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopMicrophone = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current
        .getTracks()
        .forEach((track) => track.stop());

      mediaStreamRef.current = null;
    }
  };

  const getSupportedMimeType = () => {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];

    return (
      candidates.find((type) =>
        MediaRecorder.isTypeSupported(type)
      ) || ''
    );
  };

  const formatTime = (seconds) => {
    const total = Math.max(0, Math.floor(seconds || 0));
    const minute = String(Math.floor(total / 60)).padStart(2, '0');
    const second = String(total % 60).padStart(2, '0');

    return `${minute}:${second}`;
  };

  // =========================
  // 多文件上传
  // =========================
  const handleFileUpload = (event) => {
    const selectedFiles = Array.from(event.target.files || []);

    if (selectedFiles.length === 0) {
      return;
    }

    const newFiles = selectedFiles.map((file) => ({
      id: createFileId(file.name),
      name: file.name,
      type: 'upload',
      file,
      // 只有音频文件需要生成播放地址
      url: file.type.startsWith('audio/')
        ? URL.createObjectURL(file)
        : '',
    }));

    // 不覆盖旧文件，而是追加
    setMeetingFiles((prev) => [
      ...prev,
      ...newFiles,
    ]);

    // 清空 input，避免重复选择同一个文件时不触发 change
    event.target.value = '';
  };

  // =========================
  // 开始录音
  // =========================
  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('当前浏览器不支持麦克风录音，请使用新版 Chrome 或 Edge。');
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      alert('当前浏览器不支持 MediaRecorder。');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      const mimeType = getSupportedMimeType();

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        console.error('录音错误：', event);
        alert('录音过程中出现错误，请重新尝试。');
      };

      recorder.onstop = () => {
        const actualType =
          recorder.mimeType ||
          audioChunksRef.current[0]?.type ||
          'audio/webm';

        const blob = new Blob(audioChunksRef.current, {
          type: actualType,
        });

        console.log('录音格式：', actualType);
        console.log('录音大小：', blob.size);

        stopMicrophone();

        if (blob.size === 0) {
          alert('没有录制到有效音频，请重新录制。');
          return;
        }

        let extension = 'webm';

        if (actualType.includes('ogg')) {
          extension = 'ogg';
        }

        if (actualType.includes('mp4')) {
          extension = 'm4a';
        }

        const fileName = `meeting-recording-${Date.now()}.${extension}`;

        const audioFile = new File(
          [blob],
          fileName,
          {
            type: actualType,
          }
        );

        const newRecording = {
          id: createFileId(fileName),
          name: fileName,
          type: 'recording',
          file: audioFile,
          url: URL.createObjectURL(audioFile),
        };

        // 录音完成后加入文件列表
        // 支持多段录音，不会覆盖之前的录音
        setMeetingFiles((prev) => [
          ...prev,
          newRecording,
        ]);
      };

      // 每 1 秒生成一段录音数据
      recorder.start(1000);

      setIsRecording(true);
      setRecordTime(0);

      timerRef.current = setInterval(() => {
        setRecordTime((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('开始录音失败：', error);
      stopMicrophone();

      if (error?.name === 'NotAllowedError') {
        alert('麦克风权限被拒绝，请在浏览器地址栏允许使用麦克风。');
      } else if (error?.name === 'NotFoundError') {
        alert('没有检测到可用麦克风。');
      } else {
        alert('无法开始录音，请检查麦克风或浏览器权限。');
      }
    }
  };

  // =========================
  // 停止录音
  // =========================
  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state === 'inactive') {
      return;
    }

    clearRecordingTimer();
    setIsRecording(false);

    // stop 会触发最后一次 dataavailable
    recorder.stop();
  };

  // =========================
  // 删除单个文件或录音
  // =========================
  const removeMeetingFile = (id) => {
    setMeetingFiles((prev) => {
      const target = prev.find((item) => item.id === id);

      if (target?.url) {
        URL.revokeObjectURL(target.url);
      }

      return prev.filter((item) => item.id !== id);
    });
  };

  // =========================
  // 清空全部文件
  // =========================
  const clearAllFiles = () => {
    meetingFiles.forEach((item) => {
      if (item.url) {
        URL.revokeObjectURL(item.url);
      }
    });

    setMeetingFiles([]);
  };

  // =========================
  // 上传文件和录音，一起交给 AI 处理
  // =========================
  const handleAiProcessFiles = async () => {
    if (meetingFiles.length === 0) {
      alert('请先上传文件或录制音频。');
      return;
    }

    try {
      setLoading(true);

      const transcript = await transcribeMeetingFiles(meetingFiles);

      setForm((prev) => ({
        ...prev,
        content: transcript,
      }));

      alert('AI处理完成，已自动填入会议纪要。');
    } catch (error) {
      console.error(error);
      alert(error.message || 'AI处理文件失败');
    } finally {
      setLoading(false);
    }
  };

  const validate = () => {
    if (!form.title.trim()) {
      alert('请输入会议标题。');
      return false;
    }

    if (!form.date) {
      alert('请选择会议日期。');
      return false;
    }

    if (!form.content.trim()) {
      alert('请先输入会议纪要，或上传文件/录音后让 AI 生成会议纪要。');
      return false;
    }

    return true;
  };

  const saveMeeting = async () => {
    if (!validate()) return;

    try {
      setLoading(true);

      await createMeeting({
        title: form.title.trim(),
        date: form.date,
        content: form.content.trim(),
      });

      alert('会议纪要保存成功。');
      await loadMeetings();
    } catch (error) {
      console.error(error);
      alert(error.message || '保存会议纪要失败');
    } finally {
      setLoading(false);
    }
  };

  const extract = async () => {
    if (!validate()) return;

    try {
      setLoading(true);

      // 真实后端一般需要先保存会议，再用 meetingId 提取任务
      const savedMeeting = await createMeeting({
        title: form.title.trim(),
        date: form.date,
        content: form.content.trim(),
      });

      await extractTasks(savedMeeting.id);

      navigate('/ai-tasks');
    } catch (error) {
      console.error(error);
      alert(error.message || 'AI提取任务失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>会议纪要</h1>
          <p>
            上传会议文件或录制会议音频，由 AI 处理后生成会议纪要，
            并继续提取任务。
          </p>
        </div>
      </div>

      <div className="content-card">
        <div className="form-grid">
          <label className="form-group">
            会议标题
            <input
              type="text"
              placeholder="例如：课程项目第3次小组会议"
              value={form.title}
              onChange={(e) =>
                updateForm('title', e.target.value)
              }
            />
          </label>

          <label className="form-group">
            会议日期
            <input
              type="date"
              value={form.date}
              onChange={(e) =>
                updateForm('date', e.target.value)
              }
            />
          </label>
        </div>

        <div className="content-card nested-card">
          <div className="section-title">
            <h2>会议文件与录音</h2>
            <p>
              支持多个文件和多段录音，后续会一起交给 AI 处理。
            </p>
          </div>

          <div className="upload-record-grid">
            <div className="upload-box">
              <h3>上传会议文件</h3>

              <p className="muted">
                可以上传会议文档、文本、PDF 或已有音频文件。
              </p>

              <input
                type="file"
                multiple
                accept=".txt,.doc,.docx,.pdf,.mp3,.wav,.m4a,.webm,.ogg,audio/*"
                onChange={handleFileUpload}
              />
            </div>

            <div className="record-box">
              <h3>会议录音</h3>

              <p className="muted">
                可以直接用电脑麦克风录制，多次录音会分别加入文件列表。
              </p>

              <div className="record-status-line">
                <span
                  className={
                    isRecording
                      ? 'record-status recording'
                      : 'record-status'
                  }
                >
                  {isRecording
                    ? `正在录音 ${formatTime(recordTime)}`
                    : '未录音'}
                </span>
              </div>

              <div className="record-actions">
                {!isRecording ? (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={startRecording}
                    disabled={loading}
                  >
                    开始录音
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn danger"
                    onClick={stopRecording}
                  >
                    停止录音
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="file-list">
            <div className="file-list-header">
              <h3>已添加文件</h3>

              {meetingFiles.length > 0 && (
                <button
                  type="button"
                  className="btn secondary small"
                  onClick={clearAllFiles}
                  disabled={loading}
                >
                  清空全部
                </button>
              )}
            </div>

            {meetingFiles.length === 0 ? (
              <div className="empty-state small">
                暂无上传文件或录音文件
              </div>
            ) : (
              meetingFiles.map((item, index) => (
                <div className="file-item" key={item.id}>
                  <div className="file-info">
                    <strong>
                      {index + 1}. {item.name}
                    </strong>

                    <span>
                      {item.type === 'recording'
                        ? '录音文件'
                        : '上传文件'}
                      {' · '}
                      {(item.file.size / 1024).toFixed(1)} KB
                    </span>
                  </div>

                  <div className="file-actions">
                    {item.file.type.startsWith('audio/') &&
                      item.url && (
                        <audio
                          src={item.url}
                          controls
                          preload="metadata"
                        />
                      )}

                    <button
                      type="button"
                      className="btn danger small"
                      onClick={() =>
                        removeMeetingFile(item.id)
                      }
                      disabled={loading}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="page-actions">
            <button
              type="button"
              className="btn primary"
              onClick={handleAiProcessFiles}
              disabled={loading || meetingFiles.length === 0}
            >
              {loading ? 'AI处理中...' : 'AI处理文件/录音'}
            </button>
          </div>
        </div>

        <label className="form-group">
          会议纪要
          <textarea
            rows="12"
            placeholder="可以手动输入会议纪要，也可以上传文件或录音后点击“AI处理文件/录音”。"
            value={form.content}
            onChange={(e) =>
              updateForm('content', e.target.value)
            }
          />
        </label>

        <div className="page-actions">
          <button
            type="button"
            className="btn secondary"
            onClick={saveMeeting}
            disabled={loading}
          >
            保存会议纪要
          </button>

          <button
            type="button"
            className="btn primary"
            onClick={extract}
            disabled={loading}
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