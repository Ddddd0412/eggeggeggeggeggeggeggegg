import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createMeeting,
  extractTasks,
  getMeetings,
  transcribeMeetingAudio,
  updateMeeting,
} from '../api/api';

const DEMO_MINUTES = '下周三前，小王整理实验数据，小李完成展示PPT，大家周五讨论测试结果。';
const AUDIO_MAX_BYTES = 25 * 1024 * 1024;

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function chooseRecordingMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function extensionForMimeType(mimeType) {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

export default function Meetings({ currentUser }) {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ title: '', date: today, content: DEMO_MINUTES });
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savedMeetingId, setSavedMeetingId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioName, setAudioName] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [audioMessage, setAudioMessage] = useState('可直接录音，也可选择已有音频文件。');
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const startedAtRef = useRef(0);
  const fileInputRef = useRef(null);
  const audioUrlRef = useRef('');
  const mountedRef = useRef(true);
  const isReadOnly = currentUser?.role === 'teacher';

  useEffect(() => {
    getMeetings().then(setMeetings).catch((error) => alert(error.message));
  }, []);

  useEffect(() => {
    audioUrlRef.current = audioUrl;
  }, [audioUrl]);

  useEffect(() => () => {
    mountedRef.current = false;
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const releaseMicrophone = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const setPreviewAudio = (blob, filename, seconds = 0) => {
    setAudioUrl((previousUrl) => {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      return URL.createObjectURL(blob);
    });
    setAudioBlob(blob);
    setAudioName(filename);
    if (seconds) setRecordingSeconds(seconds);
  };

  const startRecording = async () => {
    if (isReadOnly) return alert('教师/助教账号为只读权限');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setAudioMessage('当前浏览器不支持录音，请改用“选择音频文件”。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setAudioBlob(null);
      setAudioName('');
      setAudioUrl((previousUrl) => {
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        return '';
      });
      const mimeType = chooseRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      setRecordingSeconds(0);
      setAudioMessage('正在录音，请对着麦克风讲话。');
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        if (!mountedRef.current) {
          releaseMicrophone();
          return;
        }
        const finalMimeType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: finalMimeType });
        const seconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        if (blob.size > AUDIO_MAX_BYTES) {
          setAudioMessage('本次录音超过25MB，请缩短录音后重试。');
        } else if (blob.size > 0) {
          const filename = `meeting-${new Date().toISOString().replace(/[:.]/g, '-')}.${extensionForMimeType(finalMimeType)}`;
          setPreviewAudio(blob, filename, seconds);
          setAudioMessage(`录音完成（${formatDuration(seconds)}），可先试听再转写。`);
        } else {
          setAudioMessage('没有录到有效声音，请重新录制。');
        }
        setIsRecording(false);
        releaseMicrophone();
      });
      recorder.addEventListener('error', () => {
        if (!mountedRef.current) return;
        setAudioMessage('录音发生错误，请重新录制或选择音频文件。');
        setIsRecording(false);
        releaseMicrophone();
      });
      recorder.start(1000);
      startedAtRef.current = Date.now();
      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
    } catch (error) {
      releaseMicrophone();
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      setAudioMessage(denied
        ? '麦克风权限被拒绝，请在浏览器地址栏中允许麦克风后重试。'
        : '无法启动麦克风，请检查设备连接或选择音频文件。');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
  };

  const discardAudio = () => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    releaseMicrophone();
    setAudioBlob(null);
    setAudioName('');
    setRecordingSeconds(0);
    setAudioUrl((previousUrl) => {
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      return '';
    });
    setAudioMessage('已清除音频，可重新录制或选择文件。');
  };

  const chooseAudioFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > AUDIO_MAX_BYTES) {
      setAudioMessage('音频不能超过25MB，请压缩或截取后重试。');
      return;
    }
    setRecordingSeconds(0);
    setPreviewAudio(file, file.name);
    setAudioMessage(`已选择“${file.name}”，可试听并开始转写。`);
  };

  const transcribe = async () => {
    if (isReadOnly) return alert('教师/助教账号为只读权限');
    if (!audioBlob) {
      setAudioMessage('请先录制或选择一个音频文件。');
      return;
    }
    setIsTranscribing(true);
    setAudioMessage('正在上传并转写，请稍候…');
    try {
      const result = await transcribeMeetingAudio(audioBlob, {
        fileName: audioName,
        language: 'zh',
        meetingId: savedMeetingId || undefined,
      });
      setForm((current) => {
        const currentText = current.content.trim();
        const nextContent = !currentText || currentText === DEMO_MINUTES
          ? result.text
          : currentText.includes(result.text)
            ? current.content
            : `${current.content.trimEnd()}\n${result.text}`;
        return { ...current, content: nextContent };
      });
      setAudioMessage(`转写完成，文字已填入会议纪要（${result.provider}）。请人工核对后保存。`);
    } catch (error) {
      setAudioMessage(`转写失败：${error.message}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  const validate = () => {
    if (!form.title.trim() || !form.content.trim()) {
      alert('请填写会议标题和会议纪要');
      return false;
    }
    return true;
  };

  const persistMeeting = async () => {
    if (!validate()) return;
    const saved = savedMeetingId
      ? await updateMeeting(savedMeetingId, form)
      : await createMeeting(form);
    setSavedMeetingId(saved.id);
    setMeetings((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
    return saved;
  };

  const save = async () => {
    if (isReadOnly) return alert('教师/助教账号为只读权限');
    try {
      const saved = await persistMeeting();
      if (saved) alert('会议纪要已保存');
    } catch (error) {
      alert(error.message);
    }
  };

  const extract = async () => {
    if (isReadOnly) return alert('教师/助教账号为只读权限');
    if (!validate()) return;
    setLoading(true);
    try {
      const saved = await persistMeeting();
      if (!saved) return;
      await extractTasks(saved);
      navigate('/ai-tasks');
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1>会议纪要</h1><p>录入课程小组会议内容，并将自然语言纪要转换为结构化任务草稿。</p></div></div>
      {isReadOnly && <div className="permission-banner">教师/助教账号为只读权限，可查看会议、任务和统计，不能新增会议或调用 AI。</div>}
      <div className="content-grid meetings-grid">
        <section className="panel">
          <h2>录入会议纪要</h2>
          <label>会议标题<input disabled={isReadOnly} placeholder="例如：第4次项目周会" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label>会议日期<input disabled={isReadOnly} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          <div className={`recording-box${isRecording ? ' is-recording' : ''}`}>
            <div className="recording-heading">
              <div>
                <strong><span className="recording-dot" aria-hidden="true" />录音转写</strong>
                <p aria-live="polite">{audioMessage}</p>
              </div>
              <span className="recording-time">{formatDuration(recordingSeconds)}</span>
            </div>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="audio/*,.mp3,.mp4,.mpeg,.mpga,.m4a,.ogg,.wav,.webm,.flac"
              onChange={chooseAudioFile}
              disabled={isReadOnly || isRecording || isTranscribing}
            />
            <div className="recording-controls">
              {!isRecording
                ? <button type="button" className="btn secondary" onClick={startRecording} disabled={isReadOnly || isTranscribing}>开始录音</button>
                : <button type="button" className="btn danger" onClick={stopRecording}>停止录音</button>}
              <button type="button" className="btn secondary" onClick={() => fileInputRef.current?.click()} disabled={isReadOnly || isRecording || isTranscribing}>选择音频文件</button>
              {audioBlob && <button type="button" className="btn secondary" onClick={discardAudio} disabled={isRecording || isTranscribing}>清除</button>}
              <button type="button" className="btn primary" onClick={transcribe} disabled={!audioBlob || isReadOnly || isRecording || isTranscribing}>{isTranscribing ? '转写中…' : '转写并填入纪要'}</button>
            </div>
            {audioUrl && <audio className="recording-preview" controls src={audioUrl}>当前浏览器不支持音频播放。</audio>}
            <small>支持 mp3、wav、m4a、ogg、flac、mp4、webm，单个文件不超过25MB。转写文字仍需人工核对。</small>
          </div>
          <label>会议纪要<textarea disabled={isReadOnly} rows="12" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></label>
          <div className="button-row"><button className="btn secondary" onClick={save} disabled={isReadOnly || isRecording || isTranscribing}>保存会议纪要</button><button className="btn primary" onClick={extract} disabled={loading || isReadOnly || isRecording || isTranscribing}>{loading ? 'AI提取中...' : 'AI提取任务'}</button></div>
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
