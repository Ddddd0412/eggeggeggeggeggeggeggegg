import { useEffect, useMemo, useState } from 'react';
import {
  confirmTask,
  deleteDraft,
  getDraftTasks,
  getTeamMembers,
  updateDraft as saveDraftApi,
} from '../api/api';

export default function AITasks({ currentUser }) {
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const isLeader = currentUser?.role === 'leader';
  const confirmedCount = useMemo(() => tasks.filter((task) => task.status === '已确认').length, [tasks]);

  useEffect(() => {
    Promise.all([getDraftTasks(), getTeamMembers()])
      .then(([drafts, teamMembers]) => {
        setTasks(drafts);
        setMembers(teamMembers);
      })
      .catch((error) => alert(error.message))
      .finally(() => setLoading(false));
  }, []);

  const editDraft = (id, field, value) => {
    if (!isLeader) {
      alert('仅组长可以编辑 AI 任务草稿');
      return;
    }
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, [field]: value } : task)));
  };

  const saveDraft = async (task) => {
    if (!isLeader) return alert('仅组长可以编辑 AI 任务草稿');
    setBusyId(task.id);
    try {
      const saved = await saveDraftApi(task.id, {
        title: task.title,
        assignee: task.assignee,
        deadline: task.deadline,
        priority: task.priority,
        sourceText: task.sourceText,
      });
      setTasks((prev) => prev.map((item) => (item.id === task.id ? saved : item)));
      alert('草稿修改已保存，并记录到审计日志');
    } catch (error) {
      alert(error.message);
    } finally {
      setBusyId(null);
    }
  };

  const removeDraft = async (id) => {
    if (!isLeader) return alert('仅组长可以删除 AI 任务草稿');
    setBusyId(id);
    try {
      await deleteDraft(id);
      setTasks((prev) => prev.filter((task) => task.id !== id));
    } catch (error) {
      alert(error.message);
    } finally {
      setBusyId(null);
    }
  };

  const confirm = async (task) => {
    if (!isLeader) return alert('仅组长可以最终确认任务');
    if (task.assignee === '待确认' || !task.deadline || task.deadline === '待确认') {
      return alert('负责人或截止时间仍为“待确认”，请人工补充后再确认');
    }
    setBusyId(task.id);
    try {
      await confirmTask(task);
      setTasks((prev) => prev.map((item) => (
        item.id === task.id ? { ...item, status: '已确认', needsConfirmation: false, ambiguityReason: '' } : item
      )));
      alert('任务已确认，并已加入团队任务看板');
    } catch (error) {
      alert(error.message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="panel">AI 任务草稿加载中...</div>;

  return (
    <div>
      <div className="page-header"><div><h1>AI 任务确认</h1><p>核对 AI 从会议纪要中提取的任务信息，确认后才进入团队看板。</p></div><div className="small-summary">已确认 {confirmedCount} / {tasks.length}</div></div>
      {!isLeader && <div className="permission-banner">当前身份为{currentUser?.role === 'teacher' ? '教师/助教' : '普通组员'}：可查看 AI 草稿，但只有组长可以编辑、删除和最终确认。</div>}
      <div className="panel table-panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>任务名称</th><th>负责人</th><th>截止时间</th><th>优先级</th><th>状态</th><th>会议原文</th><th>操作</th></tr></thead>
            <tbody>
              {tasks.map((task) => {
                const disabled = !isLeader || task.status === '已确认' || busyId === task.id;
                return (
                  <tr key={task.id}>
                    <td>
                      <input disabled={disabled} value={task.title} onChange={(e) => editDraft(task.id, 'title', e.target.value)} />
                      {task.needsConfirmation && <small className="draft-warning">待人工核对：{task.ambiguityReason}</small>}
                    </td>
                    <td><select disabled={disabled} value={task.assignee} onChange={(e) => editDraft(task.id, 'assignee', e.target.value)}><option>待确认</option>{members.map((member) => <option key={member.id}>{member.name}</option>)}</select></td>
                    <td><input disabled={disabled} type="date" value={task.deadline === '待确认' ? '' : task.deadline} onChange={(e) => editDraft(task.id, 'deadline', e.target.value || '待确认')} /></td>
                    <td><select disabled={disabled} value={task.priority} onChange={(e) => editDraft(task.id, 'priority', e.target.value)}><option>高</option><option>中</option><option>低</option><option>未指定</option></select></td>
                    <td><span className={`tag ${task.status === '已确认' ? 'status-done' : 'status-todo'}`}>{task.status}</span></td>
                    <td><textarea className="source-text" disabled={disabled} rows="3" value={task.sourceText} onChange={(e) => editDraft(task.id, 'sourceText', e.target.value)} /></td>
                    <td><div className="table-actions"><button className="btn small secondary" disabled={disabled} onClick={() => saveDraft(task)}>保存</button><button className="btn small primary" disabled={disabled} onClick={() => confirm(task)}>确认</button><button className="btn small danger" disabled={disabled} onClick={() => removeDraft(task.id)}>删除</button></div></td>
                  </tr>
                );
              })}
              {tasks.length === 0 && <tr><td colSpan="7" className="empty">暂无草稿，请先在“会议纪要”页面调用 AI 提取</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
