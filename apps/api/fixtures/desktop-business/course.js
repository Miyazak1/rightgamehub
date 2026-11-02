document.getElementById('displacement').addEventListener('input', event => { document.getElementById('force').textContent = (-2 * Number(event.target.value)) + ' N'; });
