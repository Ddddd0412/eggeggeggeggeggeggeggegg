import { useEffect, useState } from 'react';
import { Bar, Pie } from 'react-chartjs-2';
import { ArcElement, BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from 'chart.js';
import { getStatistics } from '../api/api';
import StatCard from '../components/StatCard';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export default function Statistics({ currentUser }) {
  const [data, setData] = useState(null);
  useEffect(() => { getStatistics().then(setData); }, []);
  if (!data) return <div className="panel">统计数据加载中...</div>;

  const barData = {
    labels: data.memberStats.map((item) => item.name),
    datasets: [
      { label: '负责任务数', data: data.memberStats.map((item) => item.total), backgroundColor: '#3b82f6' },
      { label: '已完成任务数', data: data.memberStats.map((item) => item.completed), backgroundColor: '#10b981' },
    ],
  };

  const pieData = {
    labels: data.statusCounts.map((item) => item.status),
    datasets: [{
      data: data.statusCounts.map((item) => item.count),
      backgroundColor: ['#94a3b8', '#3b82f6', '#10b981', '#ef4444'],
      borderWidth: 0,
    }],
  };

  return (
    <div>
      <div className="page-header"><div><h1>数据统计</h1><p>查看团队任务完成情况、成员负载与任务状态分布。</p></div></div>
      {currentUser?.role !== 'leader' && <div className="permission-banner">{currentUser?.role === 'teacher' ? '教师/助教可查看团队统计，但不能修改业务数据。' : '普通组员可查看基础团队统计；管理操作仅面向组长。'}</div>}
      <div className="stats-grid"><StatCard title="团队任务总数" value={data.total} /><StatCard title="已完成任务" value={data.completed} /><StatCard title="未完成任务" value={data.unfinished} /><StatCard title="已逾期任务" value={data.overdue} /><StatCard title="整体完成率" value={`${data.completionRate}%`} /></div>
      <div className="chart-grid">
        <section className="panel chart-panel"><h2>成员任务数量</h2><Bar data={barData} options={{ responsive: true, maintainAspectRatio: false }} /></section>
        <section className="panel chart-panel"><h2>任务状态占比</h2><Pie data={pieData} options={{ responsive: true, maintainAspectRatio: false }} /></section>
      </div>
    </div>
  );
}

