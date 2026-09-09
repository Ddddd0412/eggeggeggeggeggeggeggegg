const TOKEN_KEY = 'authToken';
const USER_KEY = 'currentUser';
const LAST_MEETING_KEY = 'lastExtractionMeetingId';

// 清除登录状态
function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// 所有真实后端请求统一从这里发送
async function request(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);

  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(token
        ? { Authorization: `Bearer ${token}` }
        : {}),
      ...options.headers,
    },
  });

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error('服务器返回数据格式错误');
  }

  if (!response.ok || !result.success) {
    if (response.status === 401) {
      clearSession();
    }

    throw new Error(
      result?.error?.message ||
      `请求失败：${response.status}`
    );
  }

  return result.data;
}


// ====================
// 用户
// ====================

export async function register(data) {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });

  return result.user;
}

export async function login(data) {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(data),
  });

  localStorage.setItem(
    TOKEN_KEY,
    result.token
  );

  localStorage.setItem(
    USER_KEY,
    JSON.stringify(result.user)
  );

  return result.user;
}

export async function logout() {
  try {
    await request('/api/auth/logout', {
      method: 'POST',
    });
  } finally {
    clearSession();
  }
}

export async function getCurrentUser() {
  return request('/api/auth/me');
}


// ====================
// 团队
// ====================

export async function getTeamMembers() {
  return request('/api/team/members');
}


// ====================
// 会议
// ====================

export async function getMeetings() {
  return request('/api/meetings');
}

export async function createMeeting(meeting) {
  return request('/api/meetings', {
    method: 'POST',
    body: JSON.stringify(meeting),
  });
}

// 修改已保存的会议纪要
// 如果后端最终使用 PUT，请把 PATCH 改成 PUT
export async function updateMeeting(id, meeting) {
  return request(`/api/meetings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(meeting),
  });
}


// ====================
// 语音转文字
// ====================

// 上传浏览器录音到 AI 语音转写接口
// FormData 请求不能手动设置 Content-Type
// 浏览器会自动添加 multipart boundary
export async function transcribeRecording(audioBlob) {
  if (!audioBlob) {
    throw new Error('没有可上传的录音');
  }

  const token = localStorage.getItem(TOKEN_KEY);

  const formData = new FormData();

  // 根据浏览器产生的音频格式决定扩展名
  let extension = 'webm';

  if (audioBlob.type.includes('ogg')) {
    extension = 'ogg';
  }

  if (audioBlob.type.includes('mp4')) {
    extension = 'm4a';
  }

  if (audioBlob.type.includes('mpeg')) {
    extension = 'mp3';
  }

  if (audioBlob.type.includes('wav')) {
    extension = 'wav';
  }

  formData.append(
    'audio',
    audioBlob,
    `meeting-recording.${extension}`
  );

  const response = await fetch(
    '/api/meetings/transcribe',
    {
      method: 'POST',

      // 如果已经登录，把 token 一起发给后端
      headers: token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : {},

      body: formData,
    }
  );

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error(
      '语音转写服务返回数据格式错误'
    );
  }

  if (!response.ok) {
    throw new Error(
      result?.error?.message ||
      result?.error ||
      `语音转写失败：${response.status}`
    );
  }

  // AI 接口应该返回：
  // {
  //   transcript: "识别出来的会议内容"
  // }
  if (!result.transcript) {
    throw new Error('语音转写结果为空');
  }

  return result.transcript;
}


// ====================
// AI任务草稿
// ====================

export async function extractTasks(meeting) {
  const meetingId =
    typeof meeting === 'object'
      ? meeting.id
      : meeting;

  const result = await request(
    '/api/ai/extract',
    {
      method: 'POST',

      body: JSON.stringify({
        meetingId,
      }),
    }
  );

  // 记录最后一次进行 AI 提取的会议
  // AITasks 页面可以根据 meetingId 加载对应草稿
  localStorage.setItem(
    LAST_MEETING_KEY,
    String(meetingId)
  );

  return result.drafts;
}

export async function getDraftTasks() {
  const meetingId =
    localStorage.getItem(
      LAST_MEETING_KEY
    );

  const query = meetingId
    ? `?meetingId=${meetingId}`
    : '';

  return request(
    `/api/ai/drafts${query}`
  );
}

export async function updateDraft(
  id,
  updates
) {
  return request(
    `/api/ai/drafts/${id}`,
    {
      method: 'PATCH',

      body: JSON.stringify(updates),
    }
  );
}

export async function deleteDraft(id) {
  return request(
    `/api/ai/drafts/${id}`,
    {
      method: 'DELETE',
    }
  );
}


// ====================
// 确认 AI 草稿
// ====================

export async function confirmTask(task) {
  // 先把用户在前端修改后的草稿
  // 同步保存到后端数据库
  await updateDraft(task.id, {
    title: task.title,
    assignee: task.assignee,
    deadline: task.deadline,
    priority: task.priority,
    sourceText: task.sourceText,
  });

  // 再把草稿正式确认成任务
  return request(
    '/api/tasks/confirm',
    {
      method: 'POST',

      body: JSON.stringify({
        draftId: task.id,
      }),
    }
  );
}


// ====================
// 正式任务
// ====================

export async function getTasks() {
  return request('/api/tasks');
}

export async function updateTask(
  id,
  updates
) {
  return request(
    `/api/tasks/${id}`,
    {
      method: 'PATCH',

      body: JSON.stringify(updates),
    }
  );
}

export async function deleteTask(id) {
  return request(
    `/api/tasks/${id}`,
    {
      method: 'DELETE',
    }
  );
}


// ====================
// 数据统计
// ====================

export async function getStatistics() {
  return request('/api/statistics');
}