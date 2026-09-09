import { useEffect, useState } from 'react';

const editableStatuses = ['待开始', '进行中', '已完成'];

export default function TaskModal({ task, currentUser, members = [], onClose, onSave, onDelete }) {
  const [form, setForm] = useState(task);

  useEffect(() => {
    setForm(task);
  }, [task]);

  if (!task || !form) return null;

  const isLeader = currentUser?.role === 'leader';
  const isOwner = task.assigneeId
    ? task.assigneeId === currentUser?.id
    : currentUser?.name === task.assignee;
  const canEditAll = isLeader;
  const canEditStatus = isLeader || isOwner;
  const actualStatus = editableStatuses.includes(form.statusCode) ? form.statusCode : '待开始';

  const handleSave = () => {
    // 权限校验不能只依赖按钮隐藏，执行操作时也再次检查。
    if (!canEditAll && !canEditStatus) {
      alert('你没有修改该任务的权限');
      return;
    }

    if (canEditAll) {
      onSave(task.id, {
        title: form.title,
        assigneeId: form.assigneeId,
        deadline: form.deadline,
        priority: form.priority,
        status: actualStatus,
      });
      return;
    }

    onSave(task.id, { status: actualStatus });
  };

  const handleDelete = () => {
    if (!isLeader) {
      alert('仅组长 / 管理员可以删除任务');
      return;
    }
    onDelete(task.id);
  };

  const changeAssignee = (value) => {
    const member = members.find((item) => String(item.id) === value);
    setForm({
      ...form,
      assigneeId: member ? member.id : null,
      assignee: member ? member.name : '待分配',
    });
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
            <select disabled={!canEditAll} value={form.assigneeId ?? ''} onChange={(e) => changeAssignee(e.target.value)}>
              <option value="" disabled>请选择负责人</option>
              {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </label>
          <label>
            截止日期
            <input disabled={!canEditAll} type="date" value={form.deadline || ''} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          </label>
          <label>
            优先级
            <select disabled={!canEditAll} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option>高</option><option>中</option><option>低</option><option>未指定</option>
            </select>
          </label>
          <label>
            状态
            <select
              disabled={!canEditStatus}
              value={actualStatus}
              onChange={(e) => setForm({ ...form, statusCode: e.target.value })}
            >
              <option>待开始</option><option>进行中</option><option>已完成</option>
            </select>
          </label>
        </div>

        {task.status === '已逾期' && (
          <div className="permission-tip">
            当前任务已逾期。“已逾期”由系统根据截止日期自动计算，不能手动选择。
          </div>
        )}

        <div className="source-box"><strong>会议原文：</strong>{form.sourceText || '无'}</div>
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
