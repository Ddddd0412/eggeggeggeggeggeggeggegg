import { mockAITasks, mockMeetings, mockTasks, mockUsers } from '../data/mockData';

// 模拟网络延迟。后续接真实后端时，只需要修改本文件。
const delay = (data, ms = 350) =>
  new Promise((resolve) => setTimeout(() => resolve(JSON.parse(JSON.stringify(data))), ms));

const getStoredTasks = () => {
  const saved = localStorage.getItem('mockTasks');
  return saved ? JSON.parse(saved) : mockTasks;
};

const saveStoredTasks = (tasks) => {
  localStorage.setItem('mockTasks', JSON.stringify(tasks));
};

const getStoredMeetings = () => {
  const saved = localStorage.getItem('mockMeetings');
  return saved ? JSON.parse(saved) : mockMeetings;
};

const saveStoredMeetings = (meetings) => {
  localStorage.setItem('mockMeetings', JSON.stringify(meetings));
};

export async function register(payload) {
  // 真实接口位置：POST /api/auth/register
  const users = JSON.parse(localStorage.getItem('mockUsers') || JSON.stringify(mockUsers));
  if (users.some((user) => user.email === payload.email)) {
    throw new Error('该邮箱已被注册');
  }
  const newUser = {
    id: Date.now(),
    name: payload.username,
    email: payload.email,
    password: payload.password,
    role: payload.role,
    teamId: 1,
    teamName: payload.teamName,
  };
  users.push(newUser);
  localStorage.setItem('mockUsers', JSON.stringify(users));
  return delay({ success: true, user: newUser });
}

export async function login({ email, password }) {
  // 真实接口位置：POST /api/auth/login
  const users = JSON.parse(localStorage.getItem('mockUsers') || JSON.stringify(mockUsers));
  const user = users.find((item) => item.email === email && item.password === password);
  if (!user) throw new Error('邮箱或密码错误');
  const { password: _password, ...safeUser } = user;
  return delay(safeUser);
}

export async function getMeetings() {
  // GET /api/meetings
  return delay(getStoredMeetings());
}

export async function createMeeting(meeting) {
  // POST /api/meetings
  const meetings = getStoredMeetings();
  const newMeeting = { ...meeting, id: Date.now() };
  const next = [newMeeting, ...meetings];
  saveStoredMeetings(next);
  return delay(newMeeting);
}

export async function extractTasks(meeting) {
  // 真实接口位置：POST /api/ai/extract
  // 当前仅返回 Mock 数据；不在前端直接调用真实大语言模型 API。
  const tasks = mockAITasks.map((task) => ({ ...task, meetingTitle: meeting.title }));
  localStorage.setItem('aiDraftTasks', JSON.stringify(tasks));
  return delay(tasks, 600);
}

export async function getTasks() {
  // GET /api/tasks
  return delay(getStoredTasks());
}

export async function confirmTask(task) {
  // POST /api/tasks/confirm
  const tasks = getStoredTasks();
  const newTask = {
    ...task,
    id: Date.now(),
    status: '待开始',
    assignee: task.assignee || '待确认',
    deadline: task.deadline || '待确认',
  };
  const next = [...tasks, newTask];
  saveStoredTasks(next);
  return delay(newTask);
}

export async function updateTask(id, updates) {
  // PUT /api/tasks/:id
  const tasks = getStoredTasks();
  const next = tasks.map((task) => (task.id === id ? { ...task, ...updates } : task));
  saveStoredTasks(next);
  return delay(next.find((task) => task.id === id));
}

export async function deleteTask(id) {
  // DELETE /api/tasks/:id
  const next = getStoredTasks().filter((task) => task.id !== id);
  saveStoredTasks(next);
  return delay({ success: true });
}

export async function getStatistics() {
  // GET /api/statistics
  const tasks = getStoredTasks();
  const members = ['张三', '李四', '小王', '小李'];
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === '已完成').length;
  const overdue = tasks.filter((task) => task.status === '已逾期').length;
  const statusCounts = ['待开始', '进行中', '已完成', '已逾期'].map((status) => ({
    status,
    count: tasks.filter((task) => task.status === status).length,
  }));
  const memberStats = members.map((name) => ({
    name,
    total: tasks.filter((task) => task.assignee === name).length,
    completed: tasks.filter((task) => task.assignee === name && task.status === '已完成').length,
  }));

  return delay({
    total,
    completed,
    unfinished: total - completed,
    overdue,
    completionRate: total ? Math.round((completed / total) * 100) : 0,
    statusCounts,
    memberStats,
  });
}
