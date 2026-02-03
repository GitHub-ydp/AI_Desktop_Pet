# AI Desktop Pet - AGENTS.md

This document provides essential information for AI coding agents working on the AI Desktop Pet project.

## Project Overview

**AI Desktop Pet** is an intelligent desktop companion application powered by AI, similar to the classic QQ Pet concept. It creates a cute, interactive pet on the user's desktop that can engage in conversations, display different personalities, and provide companionship.

### Key Features
- 🤖 **AI Chat** - Natural language conversations powered by DeepSeek AI
- 🎭 **Four Personalities** - Healing, Funny, Tsundere (Cool), and Assistant types
- 💕 **Mood System** - Pet's mood changes based on user interaction
- 📱 **Desktop Experience** - Transparent window, always on top, draggable
- 💾 **Local Storage** - All data stored locally for privacy
- 🚀 **No Login Required** - Ready to use out of the box

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Desktop Framework | Electron | ^40.1.0 | Cross-platform desktop app |
| Frontend Framework | Vue 3 | ^3.4.0 | UI framework (loaded via CDN) |
| Build Tool | electron-builder | ^24.9.1 | Application packaging |
| AI Service | DeepSeek API | v1 | Chat completions API |
| Storage | LocalStorage | - | Local data persistence |
| Styling | Vanilla CSS | - | Custom styles in style.css |

## Project Structure

```
C:\Users\Administrator\Desktop\jizhang/
├── main.js                    # Electron main process
├── preload.js                 # Preload script for IPC
├── index.html                 # Main HTML entry point
├── package.json               # Project dependencies and scripts
├── .gitignore                 # Git ignore rules
├── .npmrc                     # NPM registry configuration (uses npmmirror)
├── README.md                  # User-facing documentation (Chinese)
├── QUICKSTART.md              # Quick start guide (Chinese)
├── AGENTS.md                  # This file - for AI agents
│
├── src/                       # Source code
│   ├── app.js                 # Vue 3 application (not used, reference only)
│   ├── app-vanilla.js         # Main application logic (CURRENTLY USED)
│   ├── api.js                 # DeepSeek API integration
│   ├── prompts.js             # Personality definitions and prompts
│   ├── storage.js             # LocalStorage management
│   ├── style.css              # Application styles
│   ├── vue.global.js          # Vue 3 global build (redirects to CDN)
│   └── components/            # Empty directory (reserved for future)
│
├── assets/                    # Static assets
│   ├── icon.png               # Application icon
│   ├── icon_placeholder.txt   # Icon placeholder notice
│   └── README.md              # Icon usage instructions
│
├── build/                     # Build resources (empty, reserved)
│
├── docs/
│   └── plans/
│       └── 2025-01-30-ai-desktop-pet-design.md  # Design documentation
│
└── node_modules/              # Dependencies (gitignored)
```

## Architecture Details

### Main Process (main.js)
The Electron main process handles:
- Window creation with specific properties (frameless, transparent, always on top)
- System tray integration with context menu
- Auto-launch on startup configuration
- IPC handlers for window movement and minimization
- Single instance lock (prevents multiple app instances)

**Window Configuration:**
- Size: 200x200px
- Position: Fixed at (100, 100) initially
- Frame: None
- Transparent: Yes (backgroundColor: '#00000000')
- Always on top: Yes
- Skip taskbar: No (shows in taskbar)

### Renderer Process
The application uses vanilla JavaScript (not Vue 3 currently) loaded via script tags:
1. `src/storage.js` - Storage module (exposes `window.PetStorage`)
2. `src/prompts.js` - Personality prompts (exposes `window.PersonalityPrompts`)
3. `src/api.js` - API module (exposes `window.PetAPI`)
4. `src/app-vanilla.js` - Main app logic (uses global state)

### Data Flow
```
User Interaction
       ↓
app-vanilla.js (event handlers)
       ↓
┌──────┴──────┐
↓             ↓
PetStorage   PetAPI
(LocalStorage) (DeepSeek API)
       ↓             ↓
       └──────┬──────┘
              ↓
        UI Updates
```

## Build and Development Commands

### Development
```bash
# Install dependencies
npm install

# Run in development mode (with DevTools)
npm run dev

# Run normally
npm start
```

### Building
```bash
# Build for current platform
npm run build

# Build for specific platforms
npm run build:win      # Windows (NSIS installer)
npm run build:mac      # macOS (DMG)
npm run build:linux    # Linux (AppImage)
```

**Output:** Built applications are placed in the `dist/` directory.

## Configuration

### DeepSeek API Key
**CRITICAL:** The AI functionality requires a valid DeepSeek API Key.

1. Edit `src/api.js`
2. Replace the API_KEY constant:
   ```javascript
   const API_KEY = 'your-deepseek-api-key-here';
   ```
3. Get your API key from: https://platform.deepseek.com/

**Note:** The current implementation has a hardcoded key that should be replaced. The code includes a mock response fallback when the API is unavailable.

### NPM Registry
The project uses npmmirror (China mirror) for faster downloads:
```ini
# .npmrc
registry=https://registry.npmmirror.com
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

## Code Organization and Conventions

### File Naming
- Kebab-case for multi-word files: `app-vanilla.js`
- Descriptive names: `prompts.js`, `storage.js`

### Code Style
- Comments in Chinese (项目主要使用中文注释)
- 2-space indentation
- Single quotes for strings
- Semicolons optional but mostly used

### Module Pattern
All modules expose their API via `window` object:
```javascript
// Module exposes global API
window.ModuleName = {
  method1,
  method2
};
```

### State Management
Uses a global state object in `app-vanilla.js`:
```javascript
let state = {
  currentPet: '🐱',
  currentPersonality: 'healing',
  mood: 80,
  // ...
};
```

## Key Modules

### 1. storage.js - Data Persistence
Handles all LocalStorage operations:
- `getPetData()` / `savePetData()` - Pet state
- `getChatHistory()` / `addChatMessage()` - Chat history
- `getSettings()` / `saveSettings()` - User settings
- `updateMood()` / `checkMoodDecay()` - Mood system
- `resetAllData()` - Clear all data

**Storage Keys:**
- `pet_data` - Pet state (emoji, personality, mood, lastInteraction)
- `chat_history` - Array of messages (max 500 entries)
- `settings` - User preferences

### 2. prompts.js - Personality System
Defines 4 personalities with unique characteristics:

| Personality | Key | Emoji | Description |
|------------|-----|-------|-------------|
| 治愈陪伴型 | healing | 💕 | Gentle, caring, supportive |
| 搞笑逗比型 | funny | 😂 | Humorous, joke-telling |
| 毒舌傲娇型 | cool | 😤 | Tsundere, aloof but caring |
| 贴心助理型 | assistant | 📋 | Professional, efficiency-focused |

Each personality includes:
- `systemPrompt` - AI system prompt for the character
- `autoSpeakPhrases` - Array of 20 phrases for random speech

### 3. api.js - AI Integration
Communicates with DeepSeek API:
- `chatWithAI(message, personality, history)` - Main chat function
- `callDeepSeekAPI(messages, personality)` - Raw API call
- `testAPIConnection()` - Connection test
- `getMockResponse()` - Fallback when API fails

**API Configuration:**
- Model: `deepseek-chat`
- Max tokens: 100
- Temperature: 0.8
- History limit: Last 10 messages

## Testing Strategy

### Manual Testing Checklist
- [ ] Application launches without errors
- [ ] Pet appears on desktop (emoji visible)
- [ ] Clicking pet shows quick menu
- [ ] Chat dialog opens and accepts input
- [ ] AI responds (with valid API key)
- [ ] Settings panel opens
- [ ] Can switch pets and personalities
- [ ] Chat history persists after restart
- [ ] Tray icon works (show/hide/exit)
- [ ] Window is draggable

### Debug Mode
Run `npm run dev` to open DevTools automatically.

### Common Issues
1. **AI not responding** - Check API key configuration in `src/api.js`
2. **Window not draggable** - Check `-webkit-app-region` CSS property
3. **Storage not persisting** - LocalStorage is cleared if user manually clears browser data

## Security Considerations

### API Key Security
- ⚠️ **Current Issue:** API key is hardcoded in `src/api.js`
- **Recommendation:** Implement a configuration file or environment variable approach
- **Never commit real API keys** to public repositories

### Data Privacy
- All user data is stored locally in LocalStorage
- No data is sent to external servers except DeepSeek API
- Chat history is not encrypted (stored as plain JSON)

### Electron Security
- `nodeIntegration: true` and `contextIsolation: false` are enabled (convenience over security)
- For production hardening, consider enabling contextIsolation and using preload.js for IPC

## Deployment Process

### Windows
1. Run `npm run build:win`
2. Installer created at `dist/AI Desktop Pet Setup 1.0.0.exe`
3. Distribute the installer

### macOS
1. Run `npm run build:mac`
2. DMG created at `dist/AI Desktop Pet-1.0.0.dmg`
3. Code signing may be required for distribution

### Linux
1. Run `npm run build:linux`
2. AppImage created at `dist/AI Desktop Pet-1.0.0.AppImage`

## Future Improvements (From Design Doc)

### V1.1 Planned Features
- [ ] Custom image upload for pets
- [ ] Voice dialogue (speech recognition + TTS)
- [ ] More interactions (petting, feeding)

### V1.2 Planned Features
- [ ] Cloud sync (login, multi-device)
- [ ] Community sharing
- [ ] Pet evolution system

### V2.0 Planned Features
- [ ] Multiple pets simultaneously
- [ ] Pet interactions with each other
- [ ] Plugin system for third-party extensions

## Important Notes for Agents

1. **Language:** Project comments and documentation are primarily in Chinese. Maintain this convention.

2. **Current Implementation:** The active application logic is in `app-vanilla.js`, NOT `app.js` (Vue version exists but is unused).

3. **API Key:** Always remind users to configure their own DeepSeek API key before using AI features.

4. **Storage Limits:** LocalStorage has a ~5MB limit. The app limits chat history to 500 entries.

5. **Dependencies:** Vue is loaded from CDN in index.html, not bundled. Check the script tag if Vue features are needed.

6. **Platform Differences:** 
   - Windows: Uses NSIS installer
   - macOS: Uses DMG
   - Linux: Uses AppImage

7. **Testing:** Always test window dragging, tray functionality, and storage persistence after changes.

---

**Document Version:** 1.0
**Last Updated:** 2026-02-02
**Project Language:** Chinese (zh-CN)
