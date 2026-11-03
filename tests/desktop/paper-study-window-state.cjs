// A library row can already say "draft saved" while the selected work panel
// is still loading. Only the work-panel status and tabs establish readiness.
function paperStatusReady(document, status) {
  return Boolean(document.querySelector('.paper-study__work header [role=status]')?.textContent.includes(status)
    && document.querySelector('#paper-tab-draft'));
}
const paperStatusSource = status => `(${paperStatusReady.toString()})(document,${JSON.stringify(status)})`;
module.exports = { paperStatusReady, paperStatusSource };
