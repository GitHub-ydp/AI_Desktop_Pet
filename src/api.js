// Renderer chat API shim. The actual LLM/tool runtime lives in the main process.

let legacyAgentSessionId = null;
let legacyAgentPersonality = null;

async function ensureLegacyRendererAgentSession(personality) {
  if (!window.PetAgent) {
    throw new Error('PetAgent unavailable');
  }

  if (!legacyAgentSessionId || legacyAgentPersonality !== personality) {
    const started = await window.PetAgent.startSession({
      channel: 'renderer-chat',
      metadata: { personality }
    });
    legacyAgentSessionId = started.sessionId;
    legacyAgentPersonality = personality;
  }

  return legacyAgentSessionId;
}

async function chatWithAI(userMessage, personality) {
  if (!window.PersonalityPrompts || !window.PetAgent) {
    return '遇到了点问题，请稍后再试~';
  }

  try {
    const sessionId = await ensureLegacyRendererAgentSession(personality);
    const sent = await window.PetAgent.send({
      sessionId,
      text: userMessage,
      source: 'renderer-chat'
    });

    if (sent.status === 'failed') {
      throw new Error(sent.reason || 'agent_send_failed');
    }

    const waited = await window.PetAgent.wait({
      runId: sent.runId,
      timeoutMs: 90000
    });

    if (!waited.ok) {
      throw new Error(waited.error || 'agent_wait_failed');
    }

    return waited.finalText || '';
  } catch (error) {
    console.warn('[API] PetAgent path failed:', error.message);
    return '遇到了点问题，请稍后再试~';
  }
}

window.PetAPI = {
  chatWithAI,
  isConfigured: async () => !!window.PetAgent
};
