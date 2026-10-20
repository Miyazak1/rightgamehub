export async function bootstrapAccountSession({ api, account }) {
  const resolve = async () => {
    let accessToken = null;
    try { accessToken = await account?.getAccessToken?.(); } catch {}
    let refreshToken = null;
    try { refreshToken = await account?.getRefreshToken?.(); } catch {}
    if (!accessToken && !refreshToken) return { status: 'anonymous', profile: null };

    const { data } = await api.bootstrapSession(refreshToken);
    if (!data?.authenticated || !data.profile) {
      await account?.clearTokens?.();
      return { status: 'anonymous', profile: null };
    }
    if (data.tokens) await account?.setTokens?.(data.tokens);
    return { status: 'ready', profile: data.profile };
  };

  return account?.withRefreshLock ? account.withRefreshLock(resolve) : resolve();
}
