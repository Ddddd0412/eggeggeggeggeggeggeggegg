import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createMeeting, extractTasks, getMeetings } from '../api/api';

export default function Meetings() {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ title: '', date: today, content: '下周三前，小王整理实验数据，小李完成展示PPT，大家周五讨论测试结果。' });
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { getMeetings().then(setMeetings); }, []);

  const validate = () => {
    if (!form.title.trim() || !form.content.trim()) {
      alert('请填写会议标题和会议纪要');
      return false;
    }
    return true;
  };

  const save = async () => {
    if (!validate()) return;
    const saved = await createMeeting(form);
    setMeetings((prev) => [saved, ...prev]);
    alert('会议纪要已保存');
  };

  const extract = async () => {
    if (!validate()) return;
    setLoading(true);
    await createMeeting(form);
    await extractTasks(form);
    setLoading(false);
    navigate('/ai-tasks');
  };

  return (
    <div>
      <div className="page-header"><div><h1>会议纪要</h1><p>录入课程小组会议内容，并将自然语言纪要转换为结构化任务草稿。</p></div></div>
      <div className="content-grid meetings-grid">
        <section className="panel">
          <h2>录入会议纪要</h2>
          <label>会议标题<input placeholder="例如：第4次项目周会" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label>会议日期<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          <label>会议纪要<textarea rows="12" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></label>
          <div className="button-row"><button className="btn secondary" onClick={save}>保存会议纪要</button><button className="btn primary" onClick={extract} disabled={loading}>{loading ? 'AI提取中...' : 'AI提取任务'}</button></div>
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
