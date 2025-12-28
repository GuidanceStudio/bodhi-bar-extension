async function updateButton() {
  const btn = document.getElementById('toggleBar');
  if (!btn) return;
  const data = await chrome.storage.local.get('tz_hidden');
  btn.textContent = data.tz_hidden ? 'Show Bar' : 'Hide Bar';
}

document.getElementById('toggleBar').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  const data = await chrome.storage.local.get('tz_hidden');
  const isNowHidden = !data.tz_hidden;
  
  await chrome.storage.local.set({ tz_hidden: isNowHidden });

  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "SET_VISIBILITY", hidden: isNowHidden });
    } catch (e) {
      // Content script might not be loaded on this tab
    }
  }
  
  await updateButton();
  window.close();
};

// Initialize button text when popup opens
updateButton();
