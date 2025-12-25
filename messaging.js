/**
 * MESSAGING.JS - Port and message handling
 */

let tzPort = null;
let tzPortReady = false;
let tzPortConnecting = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function safeConnectPort() {
  if (tzPortReady || tzPortConnecting) return;
  if (!chrome?.runtime?.connect) return;

  tzPortConnecting = true;

  try {
    tzPort = chrome.runtime.connect({ name: TZ_PORT_NAME });

    tzPort.onDisconnect.addListener(() => {
      tzPort = null;
      tzPortReady = false;
      tzPortConnecting = false;
    });

    tzPort.onMessage.addListener((msg) => {
      if (msg?.action === '__TZ_HANDSHAKE_OK__') {
        tzPortReady = true;
        tzPortConnecting = false;
      }
    });

    try { tzPort.postMessage(TZ_HANDSHAKE_MSG); } catch { }
    setTimeout(() => { if (!tzPortReady) tzPortConnecting = false; }, 700);
  } catch {
    tzPort = null;
    tzPortReady = false;
    tzPortConnecting = false;
  }
}

async function safeRuntimeSendMessageWithRetry(msg, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const resp = await safeRuntimeSendMessageOnce(msg);
    if (resp !== null) return resp;

    safeConnectPort();
    const backoff = Math.min(800, 80 * Math.pow(2, i));
    await sleep(backoff);
  }
  return null;
}

function safeRuntimeSendMessageOnce(msg) {
  return new Promise((resolve) => {
    try {
      if (!chrome?.runtime?.sendMessage) return resolve(null);

      chrome.runtime.sendMessage(msg, (resp) => {
        const err = chrome.runtime?.lastError;
        if (err) return resolve(null);
        resolve(resp ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}
