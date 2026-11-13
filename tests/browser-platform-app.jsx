import React, { useMemo } from 'react';
import App, { createBrowserHostAdapter } from '../packages/platform-client/src/App.jsx';
export * from '../packages/platform-client/src/App.jsx';

export default function BrowserPlatformApp(props) {
  const host = useMemo(() => {
    const browser = createBrowserHostAdapter();
    return { ...browser, account: { ...browser.account, ...props.apiClient?.fixtureAccount } };
  }, [props.apiClient]);
  return <App {...props} hostAdapter={props.hostAdapter ?? host}/>;
}
