import { useEffect, useMemo, useState } from 'react';
import {
  confirmTask,
  deleteDraft,
  getDraftTasks,
  getTeamMembers,
  updateDraft as updateDraftApi,
} from '../api/api';

export default function AITasks({ currentUser }) {
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const isLeader = currentUser?.role === 'leader';

  const confirmedCount = useMemo(
    () => tasks.filter((task) => task.status === '已确认').length,
    [tasks]
  );

  const load = async () => {
    setLoading(true);
    try {
      const [drafts, teamMembers] = await Promise.all([
        getDraftTasks(),
        getTeamMembers(),
      ]);
      setTasks(drafts);
      setMembers(teamMembers);
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateDraftField = (id, field, value) => {
    // 关键权限判断：普通组员不能通过事件函数修改 AI 草稿。
    if (!isLeader) {
      alert('仅组长 / 管理员可以编辑 AI 任务草稿');
      return;
    }

    setTasks((prev) => prev.map((task) => (
      task.id === id ? { ...task, [field]: value } : task
    )));
  };

  const saveDraft = async (task) => {
    if (!isLeader) return alert('仅组长 / 管理员可以保存 AI 任务草稿');

    try {
      const saved = await updateDraftApi(task.id, {
        title: task.title,
        assignee: task.assignee,
        deadline: task.deadline,
        priority: task.priority,
        sourceText: task.sourceText,
      });
      setTasks((prev) => prev.map((item) => item.id === task.id ? saved : item));
      alert('草稿已保存');
    } catch (error) {
      alert(error.message);
    }
  };

  const removeDraft = async (id) => {
    if (!isLeader) return alert('仅组长 / 管理员可以删除 AI 任务草稿');

    try {
      await deleteDraft(id);
      setTasks((prev) => prev.filter((task) => task.id !== id));
    } catch (error) {
      alert(error.message);
    }
  };

  const confirm = async (task) => {
    if (!isLeader) return alert('仅组长可以最终确认任务');
    if (task.assignee === '待确认' || !task.deadline || task.deadline === '待确认') {
      return alert('负责人或截止时间仍为“待确认”，请人工补充后再确认');
    }

    try {
      await confirmTask(task);
      await load();
      alert('任务已确认，并已加入团队任务看板');
    } catch (error) {
      alert(error.message);
    }
  };

  if (loading) return <div className="panel">AI 任务草稿加载中...</div>;

  return (
    <div>
      <div className="page-header">
        <div><h1>AI 任务确认</h1><p>核对 AI 从会议纪要中提取的任务信息，确认后进入团队看板。</p></div>
        <div className="small-summary">已确认 {confirmedCount} / {tasks.length}</div>
      </div>

      {!isLeader && (
        <div className="permission-banner">
          当前身份为普通组员：可查看 AI 任务草稿，但仅组长 / 管理员可以编辑、删除和最终确认。
        </div>
      )}

      <div className="panel table-panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>任务名称</th><th>负责人</th><th>截止时间</th><th>优先级</th><th>状态</th><th>会议原文</th><th>操作</th></tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const locked = task.status === '已确认';
                return (
                  <tr key={task.id}>
                    <td><input disabled={!isLeader || locked} value={task.title} onChange={(e) => updateDraftField(task.id, 'title', e.target.value)} /></td>
                    <td>
                      <select disabled={!isLeader || locked} value={task.assignee || '待确认'} onChange={(e) => updateDraftField(task.id, 'assignee', e.target.value)}>
                        <option value="待确认">待确认</option>
                        {members.map((member) => <option key={member.id} value={member.name}>{member.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        disabled={!isLeader || locked}
                        type="date"
                        value={task.deadline === '待确认' ? '' : task.deadline || ''}
                        onChange={(e) => updateDraftField(task.id, 'deadline', e.target.value || '待确认')}
                      />
                    </td>
                    <td>
                      <select disabled={!isLeader || locked} value={task.priority} onChange={(e) => updateDraftField(task.id, 'priority', e.target.value)}>
                        <option>高</option><option>中</option><option>低</option><option>未指定</option>
                      </select>
                    </td>
                    <td><span className={`tag ${locked ? 'status-done' : 'status-todo'}`}>{task.status}</span></td>
                    <td><div className="source-text">{task.sourceText}</div></td>
                    <td>
                      <div className="table-actions">
                        <button className="btn small secondary" disabled={!isLeader || locked} onClick={() => saveDraft(task)}>保存</button>
                        <button className="btn small primary" disabled={!isLeader || locked} onClick={() => confirm(task)}>确认</button>
                        <button className="btn small danger" disabled={!isLeader || locked} onClick={() => removeDraft(task.id)}>删除</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {tasks.length === 0 && <tr><td colSpan="7" className="empty">暂无 AI 任务草稿，请先在会议纪要页面执行 AI 提取。</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
