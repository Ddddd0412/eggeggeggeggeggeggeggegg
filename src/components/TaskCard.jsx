const priorityClass = { 高: 'high', 中: 'medium', 低: 'low', 未指定: 'unspecified' };
const statusClass = { 待开始: 'todo', 进行中: 'doing', 已完成: 'done', 已逾期: 'overdue' };

export default function TaskCard({ task, onClick }) {
  return (
    <button className="task-card" onClick={() => onClick(task)}>
      <div className="task-card-header">
        <strong>{task.title}</strong>
        <span className={`tag priority-${priorityClass[task.priority]}`}>{task.priority}</span>
      </div>
      <p>负责人：{task.assignee}</p>
      <p>截止日期：{task.deadline}</p>
      <span className={`tag status-${statusClass[task.status]}`}>{task.status}</span>
    </button>
  );
}

