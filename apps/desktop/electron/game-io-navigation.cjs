/** Loading indicators include child frames; only main-frame navigation retires I/O. */
function attachGameIoNavigation(contents, retire) {
  let document = contents.getURL();
  const started = (details, legacyUrl, legacySameDocument, legacyMainFrame) => {
    const main = details.isMainFrame ?? legacyMainFrame;
    const same = details.isSameDocument ?? legacySameDocument;
    const url = details.url ?? legacyUrl;
    if (main !== true) return;
    if (!same || url !== document) retire();
    document = url;
  };
  const committed = (_event, url) => { document = url; };
  contents.on('did-start-navigation', started);
  contents.on('did-navigate', committed);
  return () => { contents.removeListener('did-start-navigation', started); contents.removeListener('did-navigate', committed); };
}
module.exports = { attachGameIoNavigation };
