import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createMeeting,
  extractTasks,
  getMeetings,
  transcribeMeetingFiles,
} from '../api/api';

// 使用本地日期，不使用 toISOString，避免中国时区凌晨日期错一天
function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export default function Meetings() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    title: '',
    date: getLocalDateString(),
    content: '',
  });

  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [aiStep, setAiStep] = useState('等待录音或上传文件');

  // 上传文件和录音文件统一放在这里，支持多个文件、多段录音
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
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
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

    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
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
      url: file.type.startsWith('audio/') ? URL.createObjectURL(file) : '',
    }));

    setMeetingFiles((prev) => [...prev, ...newFiles]);
    setAiStep('已添加文件，可继续录音或点击 AI 解析为文本');

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
        // 直接使用 audio: true，避免部分电脑在降噪/回声消除下录到静音
        audio: true,
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
          console.log('录音数据块大小：', event.data.size);
        }
      };

      recorder.onerror = (event) => {
        console.error('录音错误：', event);
        alert('录音过程中出现错误，请重新尝试。');
      };

      recorder.onstop = () => {
        const actualType = recorder.mimeType || audioChunksRef.current[0]?.type || 'audio/webm';

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
        if (actualType.includes('ogg')) extension = 'ogg';
        if (actualType.includes('mp4')) extension = 'm4a';

        const fileName = `meeting-recording-${Date.now()}.${extension}`;
        const audioFile = new File([blob], fileName, { type: actualType });

        const newRecording = {
          id: createFileId(fileName),
          name: fileName,
          type: 'recording',
          file: audioFile,
          url: URL.createObjectURL(audioFile),
        };

        // 录音完成后加入文件列表，支持多段录音，不覆盖旧录音
        setMeetingFiles((prev) => [...prev, newRecording]);
        setAiStep('录音已加入文件列表，可点击 AI 解析为文本');
      };

      recorder.start(1000);

      setIsRecording(true);
      setRecordTime(0);
      setAiStep('正在录音，请完成后点击停止录音');

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

    try {
      // 停止前主动取一次最后的数据，避免最后一段声音没有写入
      if (recorder.state === 'recording') {
        recorder.requestData();
      }

      recorder.stop();
    } catch (error) {
      console.error('停止录音失败：', error);
      alert('停止录音失败，请重新尝试。');
    }
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

      const next = prev.filter((item) => item.id !== id);

      if (next.length === 0) {
        setAiStep('等待录音或上传文件');
      }

      return next;
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
    setAiStep('等待录音或上传文件');
  };

  // =========================
  // 录音 / 文件 -> 调用 AI API -> 解析为文本
  // =========================
  const handleAiTranscribe = async () => {
    if (meetingFiles.length === 0) {
      alert('请先上传文件或录制音频。');
      return;
    }

    try {
      setLoading(true);
      setAiStep('正在调用 AI API 解析录音/文件为文本...');

      const transcript = await transcribeMeetingFiles(meetingFiles);

      setForm((prev) => ({
        ...prev,
        content: transcript,
      }));

      setAiStep('AI 已解析为文本，请检查会议纪要后生成 JSON 任务草稿');
      alert('AI解析完成，文本已自动填入会议纪要。');
    } catch (error) {
      console.error(error);
      setAiStep('AI解析失败，请检查后端接口或重新上传文件');
      alert(error.message || 'AI解析文件失败');
    } finally {
      setLoading(false);
    }
  };

  const validateMeeting = () => {
    const title = form.title.trim();
    const date = form.date?.trim?.() || form.date;
    const content = form.content.trim();

    if (!title) {
      alert('请输入会议标题。');
      return false;
    }

    if (!date) {
      alert('请选择会议日期。');
      return false;
    }

    if (!content) {
      alert('请先输入会议纪要，或上传文件/录音后让 AI 解析为文本。');
      return false;
    }

    return true;
  };

  const saveMeeting = async () => {
    if (!validateMeeting()) return;

    try {
      setLoading(true);

      await createMeeting({
        title: form.title.trim(),
        date: form.date,
        meetingDate: form.date,
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

  // =========================
  // 在提示词下调用 AI 生成每个人的 JSON 草稿
  // =========================
  const generateJsonDrafts = async () => {
    if (!validateMeeting()) return;

    try {
      setLoading(true);
      setAiStep('正在保存会议纪要...');

      // 先把文本保存成会议记录，后端用 meetingId 找到文本并生成草稿
      const savedMeeting = await createMeeting({
        title: form.title.trim(),
        date: form.date,
        meetingDate: form.date,
        content: form.content.trim(),
      });

      setAiStep('正在调用 AI 生成每个人的 JSON 任务草稿...');

      await extractTasks(savedMeeting.id);

      setAiStep('JSON任务草稿已生成，等待管理员审核');
      navigate('/ai-tasks');
    } catch (error) {
      console.error(error);
      setAiStep('生成 JSON 任务草稿失败');
      alert(error.message || 'AI生成JSON任务草稿失败');
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
            录音或上传文件后，先调用 AI API 解析为文本，再基于会议纪要生成每个人的 JSON 任务草稿。
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
              onChange={(e) => updateForm('title', e.target.value)}
            />
          </label>

          <label className="form-group">
            会议日期
            <input
              type="date"
              value={form.date}
              onChange={(e) => updateForm('date', e.target.value)}
            />
          </label>
        </div>

        <div className="ai-flow-box">
          <div className="ai-flow-title">当前流程</div>
          <div className="ai-flow-steps">
            <span>1. 录音/上传</span>
            <span>2. AI解析文本</span>
            <span>3. AI生成JSON草稿</span>
            <span>4. 管理员审核</span>
            <span>5. 分发给组员</span>
          </div>
          <p>{aiStep}</p>
        </div>

        <div className="content-card nested-card">
          <div className="section-title">
            <h2>会议文件与录音</h2>
            <p>支持多个文件和多段录音，文件会统一交给 AI 处理。</p>
          </div>

          <div className="upload-record-grid">
            <div className="upload-box">
              <h3>上传会议文件</h3>
              <p className="muted">可以上传会议文档、文本、PDF 或已有音频文件。</p>

              <input
                type="file"
                multiple
                accept=".txt,.doc,.docx,.pdf,.mp3,.wav,.m4a,.webm,.ogg,audio/*"
                onChange={handleFileUpload}
              />
            </div>

            <div className="record-box">
              <h3>会议录音</h3>
              <p className="muted">可以直接用电脑麦克风录制，多次录音会分别加入文件列表。</p>

              <div className="record-status-line">
                <span className={isRecording ? 'record-status recording' : 'record-status'}>
                  {isRecording ? `正在录音 ${formatTime(recordTime)}` : '未录音'}
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
                  <button type="button" className="btn danger" onClick={stopRecording}>
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
              <div className="empty-state small">暂无上传文件或录音文件</div>
            ) : (
              meetingFiles.map((item, index) => (
                <div className="file-item" key={item.id}>
                  <div className="file-info">
                    <strong>
                      {index + 1}. {item.name}
                    </strong>

                    <span>
                      {item.type === 'recording' ? '录音文件' : '上传文件'} ·{' '}
                      {(item.file.size / 1024).toFixed(1)} KB
                    </span>
                  </div>

                  <div className="file-actions">
                    {item.file.type.startsWith('audio/') && item.url && (
                      <audio
                          src={item.url}
                          controls
                          preload="auto"
                          onError={(event) => {
                            console.error('录音播放失败：', event.currentTarget.error);
                          }}
                        />
                    )}

                    <button
                      type="button"
                      className="btn danger small"
                      onClick={() => removeMeetingFile(item.id)}
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
              onClick={handleAiTranscribe}
              disabled={loading || meetingFiles.length === 0}
            >
              {loading ? 'AI解析中...' : 'AI解析为文本'}
            </button>
          </div>
        </div>

        <label className="form-group">
          会议纪要文本
          <textarea
            rows="12"
            placeholder="可以手动输入会议纪要，也可以录音/上传文件后点击“AI解析为文本”。"
            value={form.content}
            onChange={(e) => updateForm('content', e.target.value)}
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
            onClick={generateJsonDrafts}
            disabled={loading}
          >
            生成JSON任务草稿
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
              <div className="meeting-item" key={meeting.id}>
                <div>
                  <h3>{meeting.title}</h3>
                  <p>{meeting.content}</p>
                </div>

                <span>{meeting.date || meeting.meetingDate}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
