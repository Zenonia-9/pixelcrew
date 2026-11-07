document.querySelector('#connect').onclick = async () => {
  const token = document.querySelector('#token').value.trim();
  if (!/^[a-f0-9]{64}$/.test(token)) { document.querySelector('#status').textContent = 'Enter the connection key from PixelCrew.'; return; }
  await chrome.storage.local.set({ token });
  await chrome.runtime.sendMessage({ type: 'connect' });
  document.querySelector('#token').value = '';
  document.querySelector('#status').textContent = 'Connecting…';
};
document.querySelector('#disconnect').onclick = async () => {
  await chrome.storage.local.remove('token'); await chrome.runtime.sendMessage({ type: 'disconnect' });
};
async function status() { const state = await chrome.storage.local.get('status'); document.querySelector('#status').textContent = state.status || 'Disconnected'; }
chrome.storage.onChanged.addListener(status); void status();
