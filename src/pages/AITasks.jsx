import { useMemo, useState } from 'react';
import { confirmTask } from '../api/api';
import { mockAITasks } from '../data/mockData';

export default function AITasks({ currentUser }) {
  const initial = JSON.parse(localStorage.getItem('aiDraftTasks') || JSON.stringify(mockAITasks));
  const [tasks, setTasks] = useState(initial);
  const isLeader = currentUser?.role === 'leader';
  const members = ['张三', '李四', '小王', '小李', '待确认'];
  const confirmedCount = useMemo(() => tasks.filter((task) => task.status === '已确认').length, [tasks]);

  const updateDraft = (id, field, value) => {
    // 关键权限判断：普通组员不能通过事件函数修改 AI 草稿。
    if (!isLeader) {
      alert('仅组长 / 管理员可以编辑 AI 任务草稿');
      return;
    }
    setTasks((prev) => prev.map((task) => task.id === id ? { ...task, [field]: value } : task));
  };

  const removeDraft = (id) => {
    if (!isLeader) return alert('仅组长 / 管理员可以删除 AI 任务草稿');
    setTasks((prev) => prev.filter((task) => task.id !== id));
  };

  const confirm = async (task) => {
    if (!isLeader) return alert('仅组长可以最终确认任务');
    if (task.assignee === '待确认' || !task.deadline || task.deadline === '待确认') {
      return alert('负责人或截止时间仍为“待确认”，请人工补充后再确认');
    }
    await confirmTask(task);
    setTasks((prev) => prev.map((item) => item.id === task.id ? { ...item, status: '已确认' } : item));
    alert('任务已确认，并已加入团队任务看板');
  };

  return (
    <div>
      <div className="page-header"><div><h1>AI 任务确认</h1><p>核对 AI 从会议纪要中提取的任务信息，确认后进入团队看板。</p></div><div className="small-summary">已确认 {confirmedCount} / {tasks.length}</div></div>
      {!isLeader && <div className="permission-banner">当前身份为普通组员：可查看 AI 任务草稿，但仅组长 / 管理员可以编辑、删除和最终确认。</div>}
      <div className="panel table-panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>任务名称</th><th>负责人</th><th>截止时间</th><th>优先级</th><th>状态</th><th>会议原文</th><th>操作</th></tr></thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td><input disabled={!isLeader || task.status === '已确认'} value={task.title} onChange={(e) => updateDraft(task.id, 'title', e.target.value)} /></td>
                  <td><select disabled={!isLeader || task.status === '已确认'} value={task.assignee} onChange={(e) => updateDraft(task.id, 'assignee', e.target.value)}>{members.map((name) => <option key={name}>{name}</option>)}</select></td>
                  <td><input disabled={!isLeader || task.status === '已确认'} type="date" value={task.deadline === '待确认' ? '' : task.deadline} onChange={(e) => updateDraft(task.id, 'deadline', e.target.value || '待确认')} /></td>
                  <td><select disabled={!isLeader || task.status === '已确认'} value={task.priority} onChange={(e) => updateDraft(task.id, 'priority', e.target.value)}><option>高</option><option>中</option><option>低</option></select></td>
                  <td><span className={`tag ${task.status === '已确认' ? 'status-done' : 'status-todo'}`}>{task.status}</span></td>
                  <td><div className="source-text">{task.sourceText}</div></td>
                  <td><div className="table-actions"><button className="btn small primary" disabled={!isLeader || task.status === '已确认'} onClick={() => confirm(task)}>确认</button><button className="btn small danger" disabled={!isLeader || task.status === '已确认'} onClick={() => removeDraft(task.id)}>删除</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
