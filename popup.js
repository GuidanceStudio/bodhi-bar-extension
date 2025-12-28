document.getElementById('toggleBar').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const data = await chrome.storage.local.get('tz_hidden');
  const isNowHidden = !data.tz_hidden;
  
  await chrome.storage.local.set({ tz_hidden: isNowHidden });

  try {
    await chrome.tabs.sendMessage(tab.id, { action: "SET_VISIBILITY", hidden: isNowHidden });
  } catch (e) {}
  window.close();
};
