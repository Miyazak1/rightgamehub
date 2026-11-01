let score = 0;
document.getElementById('increment').addEventListener('click', () => { document.getElementById('score').textContent = String(++score); });
document.getElementById('isolation').textContent = 'Node: ' + typeof require + ' · 桌面桥: ' + typeof window.mooyuDesktop;
