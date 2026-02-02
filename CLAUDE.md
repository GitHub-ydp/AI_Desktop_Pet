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

**Storage:** All data in LocalStorage with keys:
- `pet_data` - emoji, personality, mood, lastInteraction
- `chat_history` - up to 500 messages
- `settings` - autoSpeak toggle, etc.

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
