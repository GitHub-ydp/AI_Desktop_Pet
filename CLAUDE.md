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
- **LocalStorage:** `pet_data`, `chat_history`, `settings` (legacy)
- **SQLite:** `pet-memory.db` (conversations, memory_chunks, memory_facts, embedding_cache)

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

## Important Implementation Notes

1. **Active file is `app-vanilla.js`**, not `app.js` (Vue version is unused)
2. **API Key is hardcoded** in `src/api.js:3` - users must replace with their own DeepSeek API key
3. **Comments are in Chinese** - maintain this convention
4. **NPM uses China mirror** (npmmirror.com) via `.npmrc`
5. **Code style:** 2-space indentation, single quotes, semicolons mostly used
6. **Window dragging** implemented via IPC to main process (see `initDrag()` in app-vanilla.js)
7. **Fallback responses** in `getMockResponse()` when API fails

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
