const morningMessages = [
  '早安主人！新的一天开始啦，今天也要元气满满哦。',
  '早上好，昨晚睡得好吗？今天有什么计划呢？',
  '起床啦，我等你好久了，一起迎接美好的一天吧。',
  '早安，今天阳光正好，适合做点开心的事情。',
  '记得喝水、吃早饭，带着好心情出发吧。'
];

const eveningMessages = [
  '夜深了，该休息啦，今天辛苦了，好好睡一觉。',
  '晚安，明天又是全新的一天，期待和你再见面。',
  '好好休息哦，梦里说不定有很多奇妙的事情。',
  '今天也陪着你过来了，谢谢你，晚安。',
  '睡个好觉吧，我会在这里等你明天醒来。'
];

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function getPayload() {
  try {
    if (location.hash && location.hash.length > 1) {
      return JSON.parse(decodeURIComponent(location.hash.slice(1)));
    }
  } catch (error) {
    console.warn('[DailyCard] Failed to parse payload:', error);
  }
  return { type: 'morning' };
}

function getPetData() {
  try {
    const raw = localStorage.getItem('pet_data');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function getPetEmoji() {
  return getPetData().emoji || '🐱';
}

function getPetName() {
  return getPetData().name || '小宠物';
}

function getDateText() {
  const now = new Date();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]}`;
}

function renderWeeklyStats(stats) {
  const statsGrid = document.getElementById('statsGrid');
  const cards = [
    { value: stats.userMessages || 0, label: '本周对话' },
    { value: stats.avgMood !== null && stats.avgMood !== undefined ? `${stats.avgMood}分` : '--', label: '平均心情' },
    { value: stats.busiestDay || '--', label: '最活跃' },
    { value: stats.totalMessages || 0, label: '全部消息' }
  ];

  statsGrid.innerHTML = cards.map((card) => `
    <div class="stat-card">
      <div class="stat-value">${card.value}</div>
      <div class="stat-label">${card.label}</div>
    </div>
  `).join('');
}

function render() {
  const payload = getPayload();
  const stats = payload.stats || {};
  const petName = getPetName();
  const windowTitle = document.getElementById('windowTitle');
  const petEmoji = document.getElementById('petEmoji');
  const ritualTitle = document.getElementById('ritualTitle');
  const ritualSubtitle = document.getElementById('ritualSubtitle');
  const messageBubble = document.getElementById('messageBubble');
  const weeklyStats = document.getElementById('weeklyStats');

  petEmoji.textContent = getPetEmoji();

  if (payload.type === 'evening') {
    windowTitle.textContent = '晚安陪伴';
    ritualTitle.textContent = '晚安';
    ritualSubtitle.textContent = `${getDateText()}\n${petName}陪你一起收尾今天。`;
    messageBubble.style.display = 'block';
    messageBubble.textContent = randomFrom(eveningMessages);
    return;
  }

  if (payload.type === 'weekly') {
    let moodComment = '下周继续一起加油。';
    if (stats.avgMood !== null && stats.avgMood !== undefined) {
      if (stats.avgMood >= 80) moodComment = '这周你的状态很棒。';
      else if (stats.avgMood >= 60) moodComment = '这周整体状态不错。';
      else moodComment = '辛苦了，下周会更好的。';
    }

    windowTitle.textContent = '本周周报';
    ritualTitle.textContent = '本周小结';
    ritualSubtitle.textContent = `${petName}整理了这周的陪伴记录。`;
    messageBubble.style.display = 'block';
    messageBubble.textContent = `这周我们聊了 ${stats.userMessages || 0} 次。${moodComment}${stats.busiestDay ? ` 你最活跃的是${stats.busiestDay}。` : ''}`;
    weeklyStats.style.display = 'block';
    renderWeeklyStats(stats);
    return;
  }

  windowTitle.textContent = '早安问候';
  ritualTitle.textContent = '早安';
  ritualSubtitle.textContent = `${getDateText()}\n${petName}已经准备好和你一起开始新的一天。`;
  messageBubble.style.display = 'block';
  messageBubble.textContent = randomFrom(morningMessages);
}

document.addEventListener('DOMContentLoaded', render);
