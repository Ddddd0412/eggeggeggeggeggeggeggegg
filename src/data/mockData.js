export const mockUsers = [
  {
    id: 1,
    name: '张三',
    email: 'zhangsan@example.com',
    password: '123456',
    role: 'leader',
    teamId: 1,
    teamName: 'AI课程项目组',
  },
  {
    id: 2,
    name: '李四',
    email: 'lisi@example.com',
    password: '123456',
    role: 'member',
    teamId: 1,
    teamName: 'AI课程项目组',
  },
  {
    id: 3,
    name: '小王',
    email: 'xiaowang@example.com',
    password: '123456',
    role: 'member',
    teamId: 1,
    teamName: 'AI课程项目组',
  },
  {
    id: 4,
    name: '小李',
    email: 'xiaoli@example.com',
    password: '123456',
    role: 'member',
    teamId: 1,
    teamName: 'AI课程项目组',
  },
];

export const mockMeetings = [
  {
    id: 1,
    title: '第3次项目周会',
    date: '2026-09-08',
    content: '下周三前，小王整理实验数据，小李完成展示PPT，大家周五讨论测试结果。',
  },
  {
    id: 2,
    title: '需求分析会议',
    date: '2026-09-05',
    content: '李四负责整理用户需求，张三确认系统功能范围。',
  },
];

export const mockTasks = [
  { id: 1, title: '整理实验数据', assignee: '小王', deadline: '2026-09-16', priority: '高', status: '待开始', sourceText: '小王整理实验数据' },
  { id: 2, title: '完成展示PPT', assignee: '小李', deadline: '2026-09-16', priority: '中', status: '进行中', sourceText: '小李完成展示PPT' },
  { id: 3, title: '整理用户需求', assignee: '李四', deadline: '2026-09-12', priority: '高', status: '进行中', sourceText: '李四负责整理用户需求' },
  { id: 4, title: '确认系统功能范围', assignee: '张三', deadline: '2026-09-10', priority: '中', status: '已完成', sourceText: '张三确认系统功能范围' },
  { id: 5, title: '绘制前端页面原型', assignee: '李四', deadline: '2026-09-14', priority: '中', status: '待开始', sourceText: '李四先完成页面原型' },
  { id: 6, title: '设计数据库表结构', assignee: '小王', deadline: '2026-09-07', priority: '高', status: '已逾期', sourceText: '小王负责数据库设计' },
  { id: 7, title: '编写接口文档', assignee: '张三', deadline: '2026-09-18', priority: '低', status: '待开始', sourceText: '张三整理接口文档' },
  { id: 8, title: '完成系统测试', assignee: '小李', deadline: '2026-09-06', priority: '高', status: '已逾期', sourceText: '小李负责基础功能测试' },
  { id: 9, title: '准备项目演示稿', assignee: '李四', deadline: '2026-09-20', priority: '低', status: '已完成', sourceText: '李四准备项目演示稿' },
];

export const mockAITasks = [
  {
    id: 101,
    title: '整理实验数据',
    assignee: '小王',
    deadline: '2026-09-16',
    priority: '高',
    status: '待确认',
    sourceText: '小王整理实验数据',
  },
  {
    id: 102,
    title: '完成展示PPT',
    assignee: '小李',
    deadline: '2026-09-16',
    priority: '中',
    status: '待确认',
    sourceText: '小李完成展示PPT',
  },
  {
    id: 103,
    title: '讨论测试结果',
    assignee: '待确认',
    deadline: '2026-09-11',
    priority: '中',
    status: '待确认',
    sourceText: '大家周五讨论测试结果',
  },
];
