// 计划管理器 - 让 AI 在复杂任务前列出执行计划，执行时实时更新状态
window.PlanManager = (() => {
  let currentPlanEl = null;  // 当前计划卡片 DOM 元素

  // 从 AI 回复文本中解析计划格式
  // 格式：【执行计划】\n1. xxx\n2. xxx
  function parsePlan(text) {
    const planMatch = text.match(/【执行计划】\n([\s\S]*?)(?:\n\n|$)/);
    if (!planMatch) return null;

    const stepsText = planMatch[1];
    const steps = [];
    const stepRegex = /(\d+)[.、]\s*(.+)/g;
    let match;
    while ((match = stepRegex.exec(stepsText)) !== null) {
      steps.push({
        id: parseInt(match[1]),
        text: match[2].trim(),
        status: 'pending'  // pending | running | done | error
      });
    }
    return steps.length > 0 ? { steps } : null;
  }

  // 从 AI 回复中检测步骤完成标记
  // 格式：✅ 完成：第X步  或  ✅ 步骤X完成
  function parseStepDone(text) {
    const match = text.match(/✅\s*(?:完成[：:]?第?|步骤)\s*(\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  // 构建计划卡片 HTML
  function buildPlanHTML(plan) {
    const stepsHTML = plan.steps.map(step => `
      <div class="plan-step plan-step--pending" data-step-id="${step.id}">
        <span class="plan-step-icon">⏳</span>
        <span class="plan-step-text">${escapeHTML(step.text)}</span>
      </div>
    `).join('');

    return `
      <div class="plan-card" id="plan-card-current">
        <div class="plan-card-header">📋 执行计划</div>
        <div class="plan-card-steps">${stepsHTML}</div>
      </div>
    `;
  }

  function escapeHTML(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 在消息气泡中插入计划卡片（替换【执行计划】文本块）
  function injectPlanCard(bubbleEl, plan) {
    const html = bubbleEl.innerHTML;
    const newHTML = html.replace(
      /【执行计划】[\s\S]*?(?=\n\n|$)/,
      buildPlanHTML(plan)
    );
    bubbleEl.innerHTML = newHTML;
    currentPlanEl = bubbleEl.querySelector('#plan-card-current');
  }

  // 更新步骤状态
  function updateStep(stepId, status) {
    if (!currentPlanEl) return;
    const stepEl = currentPlanEl.querySelector(`[data-step-id="${stepId}"]`);
    if (!stepEl) return;

    const iconEl = stepEl.querySelector('.plan-step-icon');
    stepEl.className = `plan-step plan-step--${status}`;
    const icons = { pending: '⏳', running: '🔄', done: '✅', error: '❌' };
    if (iconEl) iconEl.textContent = icons[status] || '⏳';
  }

  return { parsePlan, parseStepDone, injectPlanCard, updateStep, buildPlanHTML };
})();
