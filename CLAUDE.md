# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Desktop Pet is an Electron-based desktop application featuring an AI-powered virtual pet. The pet sits on the user's desktop, can be dragged around, and engages in conversations using the DeepSeek AI API.

**Tech Stack:** Electron + Vanilla JavaScript (Vue 3 dependency exists but is not currently used)

## Common Commands

### Development
```bash
npm install              # Install dependencies
npm start               # Run application
npm run dev             # Run with DevTools open
```

### Building
```bash
npm run build           # Build for current platform
npm run build:win       # Build Windows installer (NSIS)
npm run build:mac       # Build macOS DMG
npm run build:linux     # Build Linux AppImage
```

Output goes to `dist/` directory.

## Architecture

### Main Process (main.js)
- Creates a frameless, transparent, always-on-top window (400x500px)
- Manages system tray with show/hide/quit context menu
- Handles IPC for window dragging and minimization
- Enforces single instance lock
- Auto-launch on system startup enabled

### Renderer Process
The application uses **vanilla JavaScript**, not Vue. Key files loaded in order via `index.html`:

1. `src/storage.js` - LocalStorage wrapper, exposes `window.PetStorage`
2. `src/prompts.js` - Personality definitions, exposes `window.PersonalityPrompts`
3. `src/api.js` - DeepSeek API client, exposes `window.PetAPI`
4. `src/app-vanilla.js` - Main application logic with global state

### Module Pattern
All modules expose APIs via the global `window` object:
- `window.PetStorage` - Data persistence
- `window.PersonalityPrompts` - Personality system
- `window.PetAPI` - AI communication
- `window.electron` - IPC bridge (via preload.js contextBridge)

### Data Flow
```
User Interaction → app-vanilla.js → PetStorage/PetAPI → UI Updates
```

### Key Systems

**Personality System:** Four personality types (healing, funny, cool, assistant). Each has a system prompt for the AI and 20 auto-speak phrases. Personality changes clear chat history.

**Mood System:** 0-100 scale stored in LocalStorage. Mood decays 10 points every 2 hours without interaction. Interactions increase mood.

**Memory System (NEW):** Persistent memory system with SQLite database (`main-process/`):
- Conversations storage with timestamp, role, personality, mood
- Text chunking for efficient retrieval
- Keyword-based semantic search with temporal decay
- Time-aware memory weighting (recent memories prioritized)
- Mood-similar memory boosting
- LRU cache eviction (prepared for future embedding use)

**Storage:**
- **LocalStorage:** `pet_data`, `chat_history`, `settings`, `reminder_time_preferences` (legacy)
- **SQLite:** `pet-memory.db` (conversations, memory_chunks, memory_facts, embedding_cache, reminders, reminder_history)

## Memory System Architecture (2025-01 Implementation)

### Overview
The memory system enables the AI pet to remember and recall past conversations, creating a sense of continuity and personalization. Unlike traditional chatbots that only see the current message, our pet can reference historical context.

### Core Components

#### 1. Database Schema (`main-process/schema.sql`)
```
conversations         - Full conversation records
memory_chunks        - Text chunks for search (simplified: one chunk per conversation)
memory_facts         - Extracted structured information (prepared for future use)
embedding_cache      - Vector embedding cache (prepared for future embedding API)
```

#### 2. Search Engine (`main-process/search.js`)
- **Keyword Search**: Fast (<1ms) text-based matching
- **Temporal Decay**: Recent memories weighted higher
  - 24h: 1.5x boost
  - 7 days: 1.2x boost
  - 30+ days: 0.7x penalty
- **Mood Similarity**: Memories with similar moods get 1.2x boost

#### 3. Memory Lifecycle (`main-process/memory.js`)
1. User sends message → Save to `conversations` table
2. Sync → Create chunk in `memory_chunks` table
3. AI responds → Save both sides
4. Next query → Search `conversations` → Return relevant context

#### 4. Context Builder (`main-process/context.js`)
- Formats retrieved memories into AI-friendly context
- Personality-aware presentation
- Emotion hints for mood/personality

### Technical Decisions

**Why Keyword Search?**
- Original plan: Vector embeddings with cosine similarity
- Challenge: DeepSeek embedding API returns 404
- Solution: Keyword matching with temporal decay
- Result: <1ms response time, good relevance

**Why Simplified Chunking?**
- Original plan: Smart text chunking with overlap
- Challenge: `textChunker.chunk()` caused application freeze
- Solution: Save entire conversation as single chunk
- Result: Stable, no freezing

**Why No FTS5?**
- Challenge: SQLite compiled without FTS5 module
- Solution: Direct SQL queries with LIKE filtering
- Result: Works reliably, good performance

### Database Location
```
Windows: C:\Users\<User>\AppData\Roaming\ai-desktop-pet\pet-memory.db
```

### Memory Search Flow
```
1. User sends message → "我叫什么名字？"
2. Search engine queries conversations table
3. Keyword matching: "名字" "叫"
4. Apply temporal decay (boost recent memories)
5. Apply mood similarity (if mood data available)
6. Sort by score and return top 3
7. Context builder formats for AI
8. AI uses context to generate personalized response
```

### Configuration (`main-process/config.js`)
```javascript
temporal: {
  halfLife: 168,        // 7-day half-life
  minWeight: 0.1,       // 10% floor
  recentThreshold: 24,  // 24-hour threshold
  moodModulation: {
    enabled: true,
    highMoodThreshold: 80,
    lowMoodThreshold: 40
  }
},
cache: {
  maxSize: 5000,
  evictionBatch: 100
},
emotional: {
  enabled: true,
  moodWeighting: true
}
```

## UI/UX System (2025-02 Major Update)

### Animation System (`src/animations.js`)
Complete animation state machine managing pet behaviors:
- **States**: idle, happy, thinking, sleeping, dragging, clicked, talking, sad
- **Expression System**: Dynamic emoji switching based on mood and pet type
- **Decorations**: Particle effects (✨, 💭, 💤, 💧) for visual feedback

### Radial Menu (`src/radial-menu.js`)
Expandable circular menu replacing the old horizontal menu:
- **Layout**: 360° radial design around pet (90px radius)
- **Two Levels**: Main menu (6 items) + More menu (5 items)
- **Actions**: Chat, Settings, History, Reminder, More, Close
- **Shortcuts**: Keyboard support (Esc, Ctrl+K, Ctrl+H, Ctrl+,, Space)

### Visual Enhancements
- **Glow Effects**: Radial gradient background pulsing with animations
- **State Particles**: Sparkles (happy), thought bubbles (thinking), Z's (sleeping), tears (sad)
- **Transitions**: Smooth CSS animations with cubic-bezier easing
- **Shadows**: Dynamic drop-shadow filters adapting to state
- **Accessibility**: Reduced-motion and high-contrast support

### Interaction Improvements
- **Drag/Click Separation**: 5px threshold + 300ms time limit
- **Auto-Sleep**: Enters sleep mode after 5 minutes of inactivity
- **Sound Effects**: Optional Web Audio API feedback (click, happy)
- **Keyboard Shortcuts**:
  - `Esc`: Close all modals
  - `Ctrl+K`: Open chat
  - `Ctrl+,`: Open settings
  - `Ctrl+H`: Open history
  - `Space`: Toggle menu

## Important Implementation Notes

1. **Active file is `app-vanilla.js`**, not `app.js` (Vue version is unused)
2. **API Key via .env**: Loaded through main process, not hardcoded
3. **Comments are in Chinese** - maintain this convention
4. **NPM uses China mirror** (npmmirror.com) via `.npmrc`
5. **Code style:** 2-space indentation, single quotes, semicolons mostly used
6. **Window dragging** implemented via IPC to main process (see `initDrag()` in app-vanilla.js)
7. **Fallback responses** in `getMockResponse()` when API fails
8. **New modules**: Load order matters - animations.js and radial-menu.js must load before app-vanilla.js

## Testing Checklist

After changes, verify:
- Pet emoji visible and clickable
- Quick menu appears on click
- Chat input sends messages
- Settings panel opens and pet/personality switching works
- Chat history persists after restart
- Window is draggable
- Tray icon show/hide/quit works
- Mood updates properly
- **Reminder creation and triggering works**

## Reminder System (2025-02 Implementation)

### Overview
The reminder system enables users to set time-based reminders through natural conversation. The pet will notify users at the specified time via system notifications and in-app messages.

### Core Components

#### 1. Database Schema (`main-process/schema.sql`)
```sql
reminders              - Active reminders with scheduling info
reminder_history       - Completed reminders for learning user habits
```

**Key Fields:**
- `status`: pending, completed, cancelled, missed
- `vague_keyword`: Tracks fuzzy time expressions (一会儿, 晚点, etc.)
- `repeat_pattern`: Supports daily, weekly, monthly, yearly, or custom intervals
- `completed_at`: Actual trigger time for habit analysis

#### 2. Reminder Scheduler (`main-process/reminder.js`)
- **Check Interval**: 30 seconds
- **Overdue Handling**:
  - < 1 hour: Trigger or mark as missed (configurable)
  - 1-2 hours: Mark as missed
  - > 2 hours: Auto-cancel
- **Repeat Support**: Automatically schedules next occurrence

#### 3. Time Extraction (`src/reminder-extractor.js`)
Intelligently parses time expressions from natural language:

**Supported Time Formats:**

| Type | Examples |
|------|----------|
| Absolute | `15点30分`, `9点`, `明天下午3点` |
| Relative Minutes | `10分钟后`, `半小时后`, `2小时30分钟后` |
| Relative Days | `明天`, `后天`, `3天后` |
| Time of Day | `早上`, `中午`, `下午`, `晚上`, `凌晨` |
| Fuzzy Times | `一会儿`, `过会`, `待会`, `稍后`, `晚点` |

**Fuzzy Time Keywords:**
- `马上`, `立刻`, `立即` - 1 minute
- `一会儿`, `一会` - User preference (default 10 min)
- `过会`, `过一会` - User preference (default 10 min)
- `待会`, `待会儿` - User preference (default 10 min)
- `等一下`, `等下` - 5 minutes
- `稍等`, `稍后` - 15 minutes
- `晚点`, `晚些` - User preference (default 30 min)
- `半小时` - 30 minutes
- `半天` - 120 minutes

**Trigger Keywords:**
`提醒`, `记得`, `别忘了`, `别忘记`, `记住`, `叫我`, `喊我`, `告诉我`, `通知我`, `设个提醒`, `定个闹钟`, `记得去`, `别忘了去`, `该去`, `该做`

#### 4. User Preference Learning
System learns from user behavior:
- First time using fuzzy time: Asks for clarification
- After 3+ uses: Remembers preference automatically
- Stored in both LocalStorage and database (reminder_history table)
- Survives application restarts

**Learning Flow:**
```
User: "一会儿后提醒我喝水"
Pet: "一会儿"是多久呢？"
User: "8"
System: Saves preference "一会儿" = 8 minutes

Next time:
User: "一会儿后提醒我休息"
Pet: "根据习惯，'一会儿'一般是8分钟，对吗？"
User: "好"
System: Creates 8-minute reminder
```

### Database Migration (`main-process/migrate.js`)
- Automatic version checking via `PRAGMA user_version`
- Graceful schema updates without data loss
- Executes on every application startup
- Current version: 1

### API Usage

#### Renderer Process (via `window.PetReminder`)
```javascript
// Create reminder
await window.PetReminder.create({
  content: '喝水',
  remindAt: Date.now() + 10 * 60 * 1000,
  metadata: {
    vagueKeyword: '一会儿',
    personality: 'healing',
    mood: 80
  }
});

// Get pending reminders
const pending = await window.PetReminder.getPending();

// Get user preference
const pref = await window.PetReminder.getPreference('一会儿');
// Returns: { keyword: '一会儿', avgMinutes: 8, sampleSize: 5 }

// Analyze user habits
const habits = await window.PetReminder.analyzeHabits();

// Get reminder history
const history = await window.PetReminder.getHistory({ limit: 20 });
```

#### Main Process (via `MemoryMainProcess`)
```javascript
// All PetReminder methods are also available through memorySystem
await memorySystem.createReminder(data);
await memorySystem.getPendingReminders();
await memorySystem.cancelReminder(id);
await memorySystem.deleteReminder(id);
```

### Conversation Flow

#### Basic Reminder
```
User: "10分钟后提醒我喝水"
Pet: "好的！我会在10分钟后提醒你喝水~"
[10 minutes later]
System: Shows notification + Pet says "该喝水啦！"
```

#### Fuzzy Time (First Time)
```
User: "一会儿后提醒我休息"
Pet: "一会儿"是多久呢？"
[Chat opens with placeholder: "告诉我几分钟（数字即可）"]
User: "8"
Pet: "好的！我会在8分钟后提醒你休息~"
```

#### Fuzzy Time (With Learned Preference)
```
User: "一会儿后提醒我看看邮件"
Pet: "根据习惯，'一会儿'一般是8分钟，对吗？"
User: "好"
Pet: "好的！我会在8分钟后提醒你看看邮件~"
```

#### Reset Confirmation Flow
```
User: "晚点提醒我吃饭"
Pet: "晚点"是多久呢？"
[User closes chat and opens it again]
Pet: [Normal chat, confirmation reset]
User: "你好呀"
Pet: [Normal response]
```

### Important Implementation Details

#### 1. Async/Await Required
`ReminderExtractor.extract()` is async and must be awaited:
```javascript
// Correct ✅
const extracted = await window.ReminderExtractor.extract(message);

// Wrong ❌
const extracted = window.ReminderExtractor.extract(message);
```

#### 2. Pure Number Input Support
System accepts pure numbers as minutes:
```javascript
User input: "8"           → Understood as 8 minutes
User input: "8分钟"       → Understood as 8 minutes
User input: "好"          → Uses suggested preference
```

#### 3. Confirmation State Management
- `state.pendingReminder` stores active confirmation
- `openChat()` defaults to resetting this state
- `openChat(false)` preserves state during confirmation flow
- Opening chat without pending reminder = normal mode

#### 4. Native Module Compilation
`better-sqlite3` must be compiled for Electron's Node.js version:
```bash
# One-time setup
npm install --save-dev @electron/rebuild
npx @electron/rebuild

# Or use the provided script
fix.bat  # On Windows
```

### Configuration (`main-process/reminder.js`)
```javascript
this.overdueThreshold = 3600000;  // 1 hour threshold
this.overdueStrategy = 'miss';    // miss | catch_up | ignore
this.checkIntervalMs = 30000;     // 30 seconds
```

### Troubleshooting

**Problem:** "Content and remindAt are required"
- **Cause:** Forgetting to `await` the `extract()` call
- **Solution:** Always use `await window.ReminderExtractor.extract(message)`

**Problem:** Native module version mismatch
- **Cause:** `better-sqlite3` compiled for wrong Node.js version
- **Solution:** Run `npx @electron/rebuild -f`

**Problem:** Fuzzy time not recognized
- **Cause:** Keyword not in pattern list
- **Solution:** Add to `timePatterns` in `reminder-extractor.js`

### Files Modified (2025-02)
- `main-process/schema.sql` - Added reminders and reminder_history tables
- `main-process/reminder.js` - Scheduler with overdue handling
- `main-process/memory.js` - Integration with memory system
- `main-process/migrate.js` - Automatic database migration
- `src/reminder-extractor.js` - Time parsing with preference learning
- `src/app-vanilla.js` - UI flow and confirmation handling
- `preload.js` - IPC bridge for reminder APIs
- `package.json` - Added rebuild scripts

### Testing Checklist for Reminders
- Basic time expressions work (10分钟后, 半小时后)
- Fuzzy times trigger clarification (一会儿, 晚点)
- Pure number input accepted (8)
- Confirmation resets on chat reopen
- Learned preferences persist
- Notifications appear on trigger
- Pet speaks when reminder triggers
- Overdue reminders handled correctly
- Repeat reminders schedule next occurrence
