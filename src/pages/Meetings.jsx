import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createMeeting, extractTasks, getMeetings, transcribeAudio, updateMeeting } from '../api/api';

export default function Meetings({ currentUser }) {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ title: '', date: today, content: '下周三前，小王整理实验数据，小李完成展示PPT，大家周五讨论测试结果。' });
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [audioFile, setAudioFile] = useState(null);
  const [savedMeetingId, setSavedMeetingId] = useState(null);
  const isReadOnly = currentUser?.role === 'teacher';

  useEffect(() => {
    getMeetings().then(setMeetings).catch((error) => alert(error.message));
  }, []);

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

  const transcribe = async () => {
    if (isReadOnly) return alert('教师/助教账号为只读权限');
    if (!audioFile) return alert('请先选择录音文件');
    setTranscribing(true);
    try {
      const transcript = await transcribeAudio(audioFile);
      setForm((current) => ({ ...current, content: transcript }));
    } catch (error) {
      alert(error.message);
    } finally {
      setTranscribing(false);
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
          <div className="audio-transcription">
            <label>会议录音<input disabled={isReadOnly || transcribing} type="file" accept="audio/*,.m4a" onChange={(event) => setAudioFile(event.target.files?.[0] || null)} /></label>
            <div className="audio-actions">
              <span>{audioFile ? `${audioFile.name} · ${(audioFile.size / 1024 / 1024).toFixed(1)} MB` : '支持 M4A、MP3、WAV、WebM 等格式，上限 25MB'}</span>
              <button className="btn secondary" type="button" disabled={isReadOnly || transcribing || !audioFile} onClick={transcribe}>{transcribing ? '正在转写...' : '转写并填入纪要'}</button>
            </div>
          </div>
          <label>会议纪要<textarea disabled={isReadOnly} rows="12" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></label>
          <div className="button-row"><button className="btn secondary" onClick={save} disabled={isReadOnly}>保存会议纪要</button><button className="btn primary" onClick={extract} disabled={loading || isReadOnly}>{loading ? 'AI提取中...' : 'AI提取任务'}</button></div>
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
          </div>
        </section>
      </div>
    </div>
  );
}
