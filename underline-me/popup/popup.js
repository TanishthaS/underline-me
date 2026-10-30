// Underline Me - Popup Controller

const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_MODE = 'general';

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const toggleApiKeyBtn = document.getElementById('toggleApiKey');
  const readingModeSelect = document.getElementById('readingMode');
  const modelInput = document.getElementById('modelInput');
  const resetModelBtn = document.getElementById('resetModelBtn');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const testBtnText = document.getElementById('testBtnText');
  const saveBtnText = document.getElementById('saveBtnText');
  const statusMessage = document.getElementById('statusMessage');

  const shortcutDisplay = document.getElementById('shortcutDisplay');
  const isMac = (navigator.userAgentData?.platform || navigator.platform || '').toUpperCase().includes('MAC');
  if (shortcutDisplay && isMac) {
    shortcutDisplay.textContent = '⌘ + Shift + U';
  }

  // Load saved preferences
  chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'readingMode'], (result) => {
    if (result.geminiApiKey) apiKeyInput.value = result.geminiApiKey;
    let savedModel = result.geminiModel || 'gemini-3.8-flash';
    modelInput.value = savedModel;
    if (result.readingMode) readingModeSelect.value = result.readingMode;
  });

  resetModelBtn.addEventListener('click', () => {
    modelInput.value = 'gemini-3.8-flash';
    showStatus(`Model reset to default: gemini-3.8-flash`, 'info');
    setTimeout(clearStatus, 2000);
  });

  toggleApiKeyBtn.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleApiKeyBtn.setAttribute('title', isPassword ? 'Hide key' : 'Show key');
  });

  function showStatus(text, type = 'info') {
    statusMessage.textContent = text;
    statusMessage.className = `status-banner ${type}`;
    statusMessage.style.display = 'block';
  }

  function clearStatus() {
    statusMessage.style.display = 'none';
    statusMessage.textContent = '';
  }

  // Save Settings
  saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelInput.value.trim() || 'gemini-3.8-flash';
    const readingMode = readingModeSelect.value || DEFAULT_MODE;

    if (!apiKey) {
      showStatus('Please enter a valid Gemini API key.', 'error');
      apiKeyInput.focus();
      return;
    }

    saveBtn.disabled = true;
    saveBtnText.textContent = 'Saving...';

    chrome.storage.local.set({
      geminiApiKey: apiKey,
      geminiModel: model,
      readingMode: readingMode
    }, () => {
      saveBtn.disabled = false;
      saveBtnText.textContent = 'Save';
      showStatus('Settings & Mode saved successfully!', 'success');
      setTimeout(clearStatus, 3000);
    });
  });

  // Test Key Connection via Background Service Worker
  testBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelInput.value.trim() || 'gemini-3.8-flash';

    if (!apiKey) {
      showStatus('Please enter an API key first.', 'error');
      apiKeyInput.focus();
      return;
    }

    testBtn.disabled = true;
    testBtnText.textContent = 'Testing...';
    showStatus(`Testing connection to ${model}...`, 'info');

    try {
      chrome.runtime.sendMessage({
        action: 'TEST_API_KEY',
        apiKey: apiKey,
        model: model
      }, (response) => {
        testBtn.disabled = false;
        testBtnText.textContent = 'Test Key';

        if (chrome.runtime.lastError) {
          showStatus(`Service worker error: ${chrome.runtime.lastError.message}`, 'error');
          return;
        }

        if (response && response.success) {
          showStatus(`Verified! ${response.message}`, 'success');
        } else {
          showStatus(`Connection failed: ${response?.message || 'Unknown error'}`, 'error');
        }
      });
    } catch (err) {
      testBtn.disabled = false;
      testBtnText.textContent = 'Test Key';
      showStatus(`Error: ${err.message}`, 'error');
    }
  });
});
