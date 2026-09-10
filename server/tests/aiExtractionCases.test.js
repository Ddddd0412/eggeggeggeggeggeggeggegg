import assert from 'node:assert/strict';
import test from 'node:test';

import { extractTaskDrafts } from '../aiService.js';


const members = [
  { id: 1, name: '小王' },
  { id: 2, name: '小李' },
  { id: 3, name: '小张' },
];

async function extract(content) {
  return extractTaskDrafts(
    { meetingDate: '2026-09-08', members, content },
    { llmMode: 'mock' },
  );
}

test('案例1：多人共同负责时保留原文并要求人工拆分', async () => {
  const result = await extract('小王和小李周五完成展示PPT。');
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].assigneeId, null);
  assert.equal(result.tasks[0].needsConfirmation, true);
  assert.match(result.tasks[0].ambiguityReason, /多名负责人/);
});

test('案例2：同一成员的多项任务不跨分句继承负责人和日期', async () => {
  const result = await extract('小王周三整理实验数据，周五制作图表。');
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].assigneeText, '小王');
  assert.equal(result.tasks[1].assigneeId, null);
  assert.equal(result.tasks[1].dueDate, '2026-09-11');
  assert.equal(result.tasks[1].needsConfirmation, true);
});

test('案例3：包含多个步骤的同一行动保持为一项任务', async () => {
  const result = await extract('小王周五完成数据清洗并制作图表。');
  assert.equal(result.tasks.length, 1);
  assert.match(result.tasks[0].title, /数据清洗并制作图表/);
});

test('案例4：相对时间按会议日期解析', async () => {
  const result = await extract('小张明天提交测试报告。');
  assert.equal(result.tasks[0].dueDateText, '明天');
  assert.equal(result.tasks[0].dueDate, '2026-09-09');
});

test('案例5：否定事项不生成任务', async () => {
  const result = await extract('小王不用再修改登录页面。');
  assert.deepEqual(result.tasks, []);
});

test('案例6：已经完成的事项不生成新任务', async () => {
  const result = await extract('小李已经完成数据库设计。');
  assert.deepEqual(result.tasks, []);
});

test('案例7：条件任务保持条件与动作的完整语义', async () => {
  const result = await extract('如果测试失败，小张就回滚版本。');
  assert.equal(result.tasks.length, 1);
  assert.match(result.tasks[0].sourceQuote, /^如果测试失败/);
  assert.equal(result.tasks[0].assigneeText, '小张');
  assert.equal(result.tasks[0].needsConfirmation, true);
});

test('案例8：委婉且未分配的建议不生成任务', async () => {
  const result = await extract('最好有人整理一下项目文档。');
  assert.deepEqual(result.tasks, []);
});

test('案例9：中英文混合任务保留技术术语', async () => {
  const result = await extract('小王周五 review API response format。');
  assert.equal(result.tasks.length, 1);
  assert.match(result.tasks[0].title, /review API response format/);
  assert.equal(result.tasks[0].assigneeText, '小王');
});

test('案例10：没有行动项的纪要返回空任务列表', async () => {
  const result = await extract('本次会议仅同步项目背景，没有安排任何行动项。');
  assert.deepEqual(result.tasks, []);
});
