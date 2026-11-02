// Configuration/support failures are not connectivity failures or missing users.
export function apiLoadError(error, fallback, locale = 'zh-CN') {
  const en = locale === 'en';
  if (error?.code === 'DESKTOP_PRODUCTION_UNAVAILABLE')
    return en ? 'The website service is not ready. No local or test content was substituted.' : '网页版同源服务尚未就绪，未替换为本地或测试内容。';
  if (error?.code === 'DESKTOP_BUSINESS_ACCOUNT_ONLY' || error?.code === 'DESKTOP_AUTH_TEST_ROUTE_DISABLED')
    return en ? 'This test server only provides account APIs. Business content is not enabled; this is not a network failure.'
      : '当前测试服务器仅开放账号接口，尚未开放业务内容；不是网络故障。';
  if (error?.code === 'DESKTOP_PREVIEW_OFFLINE')
    return en ? 'This is an offline desktop preview. Server content is not connected.' : '当前为离线桌面预览，尚未连接服务器内容。';
  if (error?.code === 'DESKTOP_BUSINESS_OPERATION_UNAVAILABLE')
    return en ? 'This operation is not available in this desktop version.' : '此桌面版本尚未接通该操作。';
  return fallback;
}
