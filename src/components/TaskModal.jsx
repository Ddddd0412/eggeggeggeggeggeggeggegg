import { useEffect, useState } from 'react';

export default function TaskModal({ task, currentUser, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(task);
  const isLeader = currentUser?.role === 'leader';
  const isOwner = currentUser?.name === task?.assignee;

  useEffect(() => setForm(task), [task]);
  if (!task) return null;

  const canEditAll = isLeader;
  const canEditStatus = isLeader || isOwner;

  const handleSave = () => {
    // 权限校验不能只依赖按钮隐藏，执行操作时也再次检查。
    if (!canEditAll && !canEditStatus) {
      alert('你没有修改该任务的权限');
      return;
    }
    const allowedData = canEditAll ? form : { status: form.status };
    onSave(task.id, allowedData);
  };

  const handleDelete = () => {
    if (!isLeader) {
      alert('仅组长 / 管理员可以删除任务');
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
              {['张三', '李四', '小王', '小李'].map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label>
            截止日期
            <input disabled={!canEditAll} type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          </label>
          <label>
            优先级
            <select disabled={!canEditAll} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option>高</option><option>中</option><option>低</option>
            </select>
          </label>
          <label>
            状态
            <select disabled={!canEditStatus} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option>待开始</option><option>进行中</option><option>已完成</option><option>已逾期</option>
            </select>
          </label>
        </div>
        <div className="source-box"><strong>会议原文：</strong>{form.sourceText}</div>
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
