export function createHarnessAssistantSender(ctx, session) {
  // Bind the pane's session, never whatever conversation becomes foreground later.
  const sessionId = typeof session === 'string' ? session : session?.sessionId;
  return async prompt => {
    if (!sessionId || typeof prompt !== 'string' || !prompt.trim()) throw new Error('HOST_CHAT_SESSION_REQUIRED');
    const scoped = ctx.sessions?.scope(sessionId);
    if (typeof scoped?.conversation?.send !== 'function') throw new Error('HOST_CHAT_UNAVAILABLE');
    await scoped.conversation.send(prompt);
    return { sent: true };
  };
}
