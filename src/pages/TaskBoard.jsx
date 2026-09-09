import { useEffect, useState } from 'react';
import { deleteTask, getTasks, getTeamMembers, updateTask } from '../api/api';
import TaskCard from '../components/TaskCard';
import TaskModal from '../components/TaskModal';

const columns = ['待开始', '进行中', '已完成', '已逾期'];

export default function TaskBoard({ currentUser }) {
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);

  const load = async () => {
    try {
      const [taskList, memberList] = await Promise.all([getTasks(), getTeamMembers()]);
      setTasks(taskList);
      setMembers(memberList);
    } catch (error) {
      alert(error.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (id, updates) => {
    const task = tasks.find((item) => item.id === id);
    const isLeader = currentUser?.role === 'leader';
    const isOwner = task?.assigneeId
      ? task.assigneeId === currentUser?.id
      : task?.assignee === currentUser?.name;

    // 二次权限校验：普通组员只能修改自己任务的状态/进度。
    if (!isLeader) {
      if (!isOwner) return alert('你只能修改自己负责的任务');
      const allowed = ['status', 'progressPercent'];
      const keys = Object.keys(updates);
      if (keys.some((key) => !allowed.includes(key))) {
        return alert('普通组员只能修改自己任务的状态和进度');
      }
    }

    try {
      await updateTask(id, updates);
      setSelectedTask(null);
      await load();
    } catch (error) {
      alert(error.message);
    }
  };

  const remove = async (id) => {
    if (currentUser?.role !== 'leader') return alert('仅组长 / 管理员可以删除任务');

    try {
      await deleteTask(id);
      setSelectedTask(null);
      await load();
    } catch (error) {
      alert(error.message);
    }
  };

  return (
    <div>
      <div className="page-header"><div><h1>团队任务看板</h1><p>按任务状态查看项目进度，点击任务卡片可以查看详细信息。</p></div></div>
      <div className="kanban">
        {columns.map((status) => {
          const items = tasks.filter((task) => task.status === status);
          return (
            <section className="kanban-column" key={status}>
              <div className="kanban-title"><strong>{status}</strong><span>{items.length}</span></div>
              <div className="kanban-list">
                {items.map((task) => <TaskCard key={task.id} task={task} onClick={setSelectedTask} />)}
                {items.length === 0 && <div className="empty">暂无任务</div>}
              </div>
            </section>
          );
        })}
      </div>

      <TaskModal
        task={selectedTask}
        currentUser={currentUser}
        members={members}
        onClose={() => setSelectedTask(null)}
        onSave={save}
        onDelete={remove}
      />
    </div>
  );
}
