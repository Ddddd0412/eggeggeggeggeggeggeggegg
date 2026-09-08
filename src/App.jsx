import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Register from './pages/Register';
import Meetings from './pages/Meetings';
import AITasks from './pages/AITasks';
import TaskBoard from './pages/TaskBoard';
import MyTasks from './pages/MyTasks';
import Statistics from './pages/Statistics';

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('currentUser'));
  } catch {
    return null;
  }
}

function ProtectedRoute() {
  const currentUser = getCurrentUser();
  if (!currentUser) return <Navigate to="/login" replace />;
  return (
    <div className="app-shell">
      <Navbar currentUser={currentUser} />
      <main className="main-content"><Outlet context={{ currentUser }} /></main>
    </div>
  );
}

function MeetingsRoute() { return <Meetings />; }
function AITasksRoute() { return <AITasks currentUser={getCurrentUser()} />; }
function TaskBoardRoute() { return <TaskBoard currentUser={getCurrentUser()} />; }
function MyTasksRoute() { return <MyTasks currentUser={getCurrentUser()} />; }
function StatisticsRoute() { return <Statistics currentUser={getCurrentUser()} />; }

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/meetings" element={<MeetingsRoute />} />
        <Route path="/ai-tasks" element={<AITasksRoute />} />
        <Route path="/tasks" element={<TaskBoardRoute />} />
        <Route path="/my-tasks" element={<MyTasksRoute />} />
        <Route path="/statistics" element={<StatisticsRoute />} />
      </Route>
      <Route path="/" element={<Navigate to={getCurrentUser() ? '/meetings' : '/login'} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
