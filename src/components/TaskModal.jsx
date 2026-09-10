import { useEffect, useState } from 'react';

export default function TaskModal({ task, currentUser, members = [], onClose, onSave, onDelete }) {
  const [form, setForm] = useState(task);
  const isLeader = currentUser?.role === 'leader';
  const isOwner = currentUser?.id === task?.assigneeId;

  useEffect(() => setForm(task), [task]);
  if (!task || !form) return null;

  const canEditAll = isLeader;
  const canEditStatus = isLeader || isOwner;
  const editableStatus = form.statusCode || form.status;

  const handleSave = () => {
    if (!canEditAll && !canEditStatus) {
      alert('你没有修改该任务的权限');
      return;
    }
    const statusData = { status: editableStatus, progressPercent: Number(form.progressPercent) };
    const allowedData = canEditAll ? {
      title: form.title,
      assignee: form.assignee,
      deadline: form.deadline,
      priority: form.priority,
      description: form.description,
      ...statusData,
    } : statusData;
    onSave(task.id, allowedData);
  };

  const handleDelete = () => {
    if (!isLeader) {
      alert('仅组长可以删除任务');
      return;
    }
    onDelete(task.id);
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>任务详情</h3>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="form-grid">
          <label>
            任务名称
            <input disabled={!canEditAll} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label>
            负责人
            <select disabled={!canEditAll} value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })}>
              {members.map((member) => <option key={member.id}>{member.name}</option>)}
            </select>
          </label>
          <label>
            截止日期
            <input disabled={!canEditAll} type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          </label>
          <label>
            优先级
            <select disabled={!canEditAll} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option>高</option><option>中</option><option>低</option><option>未指定</option>
            </select>
          </label>
          <label>
            状态
            <select disabled={!canEditStatus} value={editableStatus} onChange={(e) => setForm({ ...form, status: e.target.value, statusCode: e.target.value })}>
              <option>待开始</option><option>进行中</option><option>已完成</option>{isLeader && <option>已取消</option>}
            </select>
          </label>
          <label>
            完成进度（0-100）
            <input disabled={!canEditStatus} type="number" min="0" max="100" value={form.progressPercent} onChange={(e) => setForm({ ...form, progressPercent: e.target.value })} />
          </label>
        </div>
        <div className="source-box"><strong>会议原文：</strong>{form.sourceText || '手工创建任务，无会议原文'}</div>
        {form.isOverdue && <div className="permission-tip">该任务已超过截止日期；更新状态后系统会重新计算逾期情况。</div>}
        {!canEditAll && !isOwner && <div className="permission-tip">你不是该任务负责人，当前为只读状态。</div>}
        <div className="modal-actions">
          {isLeader && <button className="btn danger" onClick={handleDelete}>删除任务</button>}
          <button className="btn secondary" onClick={onClose}>关闭</button>
          {canEditStatus && <button className="btn primary" onClick={handleSave}>保存修改</button>}
        </div>
      </div>
    </div>
  );
}

