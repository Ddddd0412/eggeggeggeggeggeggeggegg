import { useEffect, useMemo, useState } from 'react';
import { getTasks, updateTask } from '../api/api';
import StatCard from '../components/StatCard';

const editableStatuses = ['待开始', '进行中', '已完成'];

export default function MyTasks({ currentUser }) {
  const [tasks, setTasks] = useState([]);
  const [filters, setFilters] = useState({ status: '全部', priority: '全部', deadline: '默认' });

  const load = async () => {
    try {
      const all = await getTasks();
      setTasks(all.filter((task) => (
        task.assigneeId ? task.assigneeId === currentUser?.id : task.assignee === currentUser?.name
      )));
    } catch (error) {
      alert(error.message);
    }
  };

  useEffect(() => {
    load();
  }, [currentUser]);

  const counts = useMemo(() => ({
    total: tasks.length,
    todo: tasks.filter((t) => t.status === '待开始').length,
    doing: tasks.filter((t) => t.status === '进行中').length,
    done: tasks.filter((t) => t.status === '已完成').length,
    overdue: tasks.filter((t) => t.status === '已逾期').length,
  }), [tasks]);

  const filtered = useMemo(() => {
    let list = tasks
      .filter((task) => filters.status === '全部' || task.status === filters.status)
      .filter((task) => filters.priority === '全部' || task.priority === filters.priority);

    if (filters.deadline === '最早优先') {
      list = [...list].sort((a, b) => (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31'));
    }
    if (filters.deadline === '最晚优先') {
      list = [...list].sort((a, b) => (b.deadline || '').localeCompare(a.deadline || ''));
    }
    return list;
  }, [tasks, filters]);

  const changeStatus = async (task, status) => {
    const isOwner = task.assigneeId
      ? task.assigneeId === currentUser?.id
      : task.assignee === currentUser?.name;

    if (!isOwner) return alert('你只能修改自己的任务');
    if (!editableStatuses.includes(status)) return alert('“已逾期”由系统自动判断，不能手动设置');

    try {
      await updateTask(task.id, { status });
      await load();
    } catch (error) {
      alert(error.message);
    }
  };

  const rate = counts.total ? Math.round((counts.done / counts.total) * 100) : 0;

  return (
    <div>
      <div className="page-header"><div><h1>我的任务</h1><p>集中查看和更新由你负责的任务。</p></div></div>
      <div className="stats-grid six">
        <StatCard title="我的全部任务" value={counts.total} />
        <StatCard title="待开始" value={counts.todo} />
        <StatCard title="进行中" value={counts.doing} />
        <StatCard title="已完成" value={counts.done} />
        <StatCard title="已逾期" value={counts.overdue} />
        <StatCard title="个人完成率" value={`${rate}%`} />
      </div>

      <section className="panel">
        <div className="filter-row">
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option>全部</option><option>待开始</option><option>进行中</option><option>已完成</option><option>已逾期</option>
          </select>
          <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
            <option>全部</option><option>高</option><option>中</option><option>低</option><option>未指定</option>
          </select>
          <select value={filters.deadline} onChange={(e) => setFilters({ ...filters, deadline: e.target.value })}>
            <option>默认</option><option>最早优先</option><option>最晚优先</option>
          </select>
        </div>

        <div className="table-wrap">
          <table>
            <thead><tr><th>任务名称</th><th>截止日期</th><th>优先级</th><th>当前状态</th><th>更新状态</th></tr></thead>
            <tbody>
              {filtered.map((task) => {
                const editableStatus = editableStatuses.includes(task.statusCode) ? task.statusCode : '待开始';
                return (
                  <tr key={task.id}>
                    <td>{task.title}</td>
                    <td>{task.deadline || '未设置'}</td>
                    <td><span className={`tag priority-${task.priority === '高' ? 'high' : task.priority === '中' ? 'medium' : task.priority === '低' ? 'low' : 'unspecified'}`}>{task.priority}</span></td>
                    <td>{task.status}</td>
                    <td>
                      <select value={editableStatus} onChange={(e) => changeStatus(task, e.target.value)}>
                        <option>待开始</option><option>进行中</option><option>已完成</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan="5" className="empty">暂无符合条件的任务</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
