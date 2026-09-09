import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createMeeting,
  extractTasks,
  getMeetings,
  transcribeRecording,
  updateMeeting,
} from '../api/api';

export default function Meetings() {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({ title: '', date: today, content: '' });
  const [meetings, setMeetings] = useState([]);
  const [savedMeetingId, setSavedMeetingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // 录音只在浏览器本地保存；后端加入语音转文字接口后再上传 audioBlob。
  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioBlob, setAudioBlob] = useState(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioUrlRef = useRef('');

  useEffect(() => {
    loadMeetings();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const loadMeetings = async () => {
    try {
      setMeetings(await getMeetings());
    } catch (error) {
      console.error(error);
    }
  };

  const validate = () => {
    if (!form.title.trim() || !form.content.trim()) {
      alert('请填写会议标题和会议纪要');
      return false;
    }
    return true;
  };

  const saveMeetingToBackend = async () => {
    if (savedMeetingId) {
      const updated = await updateMeeting(savedMeetingId, form);
      setMeetings((prev) => prev.map((item) => item.id === updated.id ? updated : item));
      return updated;
    }

    const saved = await createMeeting(form);
    setSavedMeetingId(saved.id);
    setMeetings((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
    return saved;
  };

  const save = async () => {
    if (!validate()) return;
    try {
      await saveMeetingToBackend();
      alert('会议纪要已保存到数据库');
    } catch (error) {
      alert(error.message);
    }
  };

  const extract = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      // 后端 AI 接口需要 meetingId，所以先保存会议，再提取任务。
      const savedMeeting = await saveMeetingToBackend();
      await extractTasks(savedMeeting.id);
      navigate('/ai-tasks');
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert('当前浏览器不支持录音，请使用最新版 Chrome 或 Edge');
      return;
    }

    try {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      setAudioUrl('');
      setAudioBlob(null);
      setRecordTime(0);
      chunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';

      const recorder = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const type = chunksRef.current[0]?.type || recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        if (!blob.size) {
          alert('没有录制到有效音频，请重新录音');
          return;
        }

        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        setAudioBlob(blob);
        setAudioUrl(url);
      };

      // 每秒输出一次数据块，录音预览和后续上传更稳定。
      recorder.start(1000);
      setIsRecording(true);
      timerRef.current = setInterval(() => setRecordTime((time) => time + 1), 1000);
    } catch (error) {
      console.error(error);
      alert('无法使用麦克风，请检查浏览器麦克风权限');
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  };

  const deleteRecording = () => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = '';
    setAudioUrl('');
    setAudioBlob(null);
    setRecordTime(0);
  };

  const transcribe = async () => {
    if (!audioBlob) return alert('请先完成录音');

    setTranscribing(true);
    try {
      // 调用成员1提供的真实 AI 语音转写接口：
      // POST /api/meetings/transcribe
      const transcript = await transcribeRecording(audioBlob);

      // 将真实转写结果写入会议纪要输入框，用户仍可人工修改。
      setForm((prev) => ({
        ...prev,
        content: transcript,
      }));
    } catch (error) {
      alert(error.message);
    } finally {
      setTranscribing(false);
    }
  };

  const formatTime = (seconds) => {
    const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
    const rest = String(seconds % 60).padStart(2, '0');
    return `${minutes}:${rest}`;
  };

  return (
    <div>
      <div className="page-header">
        <div><h1>会议纪要</h1><p>录入课程小组会议内容，并将自然语言纪要转换为结构化任务草稿。</p></div>
      </div>

      <div className="content-grid meetings-grid">
        <section className="panel">
          <h2>录入会议纪要</h2>
          <label>会议标题<input placeholder="例如：第4次项目周会" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label>会议日期<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>

          <div className="record-section">
            <div className="record-header">
              <div><strong>会议录音</strong><span>浏览器本地录音，可播放预览</span></div>
              <span className={`record-status ${isRecording ? 'recording' : ''}`}>
                {isRecording ? `正在录音 ${formatTime(recordTime)}` : audioBlob ? `录音完成 ${formatTime(recordTime)}` : '未录音'}
              </span>
            </div>
            <div className="record-actions">
              {!isRecording ? (
                <button type="button" className="btn primary" onClick={startRecording}>{audioBlob ? '重新录音' : '开始录音'}</button>
              ) : (
                <button type="button" className="btn danger" onClick={stopRecording}>停止录音</button>
              )}
              {audioBlob && !isRecording && (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={transcribe}
                  disabled={transcribing}
                >
                  {transcribing ? '转写中...' : '语音转文字'}
                </button>
              )}
              {audioBlob && !isRecording && <button type="button" className="btn danger" onClick={deleteRecording}>删除录音</button>}
            </div>
            {audioUrl && <audio className="audio-player" src={audioUrl} controls preload="metadata" />}
          </div>

          <label>
            会议纪要
            <textarea
              rows="12"
              placeholder="请输入会议纪要内容，后续也可以由语音识别自动生成"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </label>
          <div className="button-row">
            <button className="btn secondary" onClick={save}>保存会议纪要</button>
            <button className="btn primary" onClick={extract} disabled={loading}>{loading ? 'AI提取中...' : 'AI提取任务'}</button>
          </div>
        </section>

        <section className="panel">
          <h2>最近会议记录</h2>
          <div className="meeting-list">
            {meetings.map((meeting) => (
              <article className="meeting-item" key={meeting.id}>
                <div><strong>{meeting.title}</strong><span>{meeting.date}</span></div>
                <p>{meeting.content}</p>
              </article>
            ))}
            {meetings.length === 0 && <div className="empty">暂无会议记录</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
