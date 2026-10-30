// Underline Me - Service Worker
// Frame-aware messaging, Gemini API client with mode-based instructions, retry loop, and on-demand injection.

const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_MODE = 'general';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const RATE_LIMIT_CEILING = 21;
const RATE_WINDOW_MS = 60000;

const requestTimestamps = [];

function recordAndCheckRateLimit() {
  const now = Date.now();
  while (requestTimestamps.length > 0 && requestTimestamps[0] <= now - RATE_WINDOW_MS) {
    requestTimestamps.shift();
  }
  requestTimestamps.push(now);
  return requestTimestamps.length >= RATE_LIMIT_CEILING;
}

// Mode Prompts Dictionary
const MODE_PROMPTS = {
  general: "You are an expert reading assistant. Extract the most important core takeaways and classify each into one of four categories: 'concept' (core idea/definition), 'evidence' (statistic, data, proof), 'critique' (limitation, caveat, counterargument), or 'takeaway' (actionable insight, conclusion). Return ONLY exact verbatim substrings that appear word-for-word in the text.",
  exam: "You are an exam tutor. Focus strictly on testable facts: definitions, formulas, theories, names, and key dates. Classify each into: 'concept' (core definition/theory), 'evidence' (data point/formula/case), 'critique' (exception/tradeoff), or 'takeaway' (exam summary point). Return ONLY exact verbatim substrings from the text.",
  speed: "You are an executive speed-reading coach. Be extremely concise: extract only the top 1 to 3 anchor phrases across the entire text that convey the core message. Classify into 'concept', 'evidence', 'critique', or 'takeaway'. Return ONLY exact verbatim substrings from the text.",
  claims: "You are a research analyst and fact-checker. Focus on identifying claims, statistical proof, citations, and conflicting points. Classify each into: 'concept' (the central hypothesis/claim), 'evidence' (empirical proof/numbers), 'critique' (counterclaim/bias/limit), or 'takeaway' (verified conclusion). Return ONLY exact verbatim substrings from the text."
};

// Setup Context Menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'underline-me-selection',
    title: 'Underline Key Points (Alt+U)',
    contexts: ['selection']
  }, () => {
    if (chrome.runtime.lastError) {}
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'underline-me-selection' && tab?.id) {
    await triggerUnderlineOnTab(tab.id, info.selectionText || null, info.frameId);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'underline-selection') {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await triggerUnderlineOnTab(tab.id);
      }
    } catch (err) {
      console.warn('[Underline Me] Tab query failed:', err);
    }
  }
});

async function triggerUnderlineOnTab(tabId, fallbackText = null, targetFrameId = null) {
  // Check if page is an internal chrome URL
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:') || tab.url.includes('aistudio.google.com')) {
      console.warn('[Underline Me] Cannot run on restricted page:', tab?.url);
      return;
    }
  } catch (e) {}

  const payload = { action: 'TRIGGER_UNDERLINE', fallbackText };

  async function sendToFrames() {
    if (targetFrameId !== null && targetFrameId !== undefined) {
      return await chrome.tabs.sendMessage(tabId, payload, { frameId: targetFrameId }).catch(() => null);
    }
    const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
    let anySelection = false;
    if (frames && frames.length > 0) {
      const promises = frames.map(frame =>
        chrome.tabs.sendMessage(tabId, payload, { frameId: frame.frameId })
          .then(res => { if (res && res.hasSelection) anySelection = true; })
          .catch(() => {})
      );
      await Promise.all(promises);
    } else {
      const res = await chrome.tabs.sendMessage(tabId, payload).catch(() => null);
      if (res && res.hasSelection) anySelection = true;
    }
    return anySelection;
  }

  let selected = await sendToFrames();

  if (!selected && !fallbackText) {
    // If not detected, try on-demand injection in case page was loaded before extension
    try {
      await chrome.scripting.insertCSS({
        target: { tabId, allFrames: true },
        files: ['content/styles.css']
      });
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content/content.js']
      });
      await new Promise(r => setTimeout(r, 100));
      selected = await sendToFrames();
    } catch (injectErr) {
      console.warn('[Underline Me] Injection failed:', injectErr.message);
    }

    if (!selected && !fallbackText) {
      chrome.tabs.sendMessage(tabId, { action: 'SHOW_TOAST', message: 'Select text first, then press ⌘ + Shift + U', type: 'info' }, { frameId: 0 }).catch(() => {});
    }
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'EXTRACT_HIGHLIGHTS') {
    handleExtractHighlights(request.text)
      .then(response => sendResponse(response))
      .catch(err => sendResponse({
        success: false,
        error: 'UNEXPECTED_ERROR',
        message: err.message || 'An unexpected error occurred.'
      }));
    return true; // Keep message port open for async response
  } else if (request.action === 'TEST_API_KEY') {
    handleTestApiKey(request.apiKey, request.model)
      .then(response => sendResponse(response))
      .catch(err => sendResponse({
        success: false,
        error: 'TEST_FAILED',
        message: err.message || 'Test connection failed.'
      }));
    return true;
  }
});

async function handleTestApiKey(apiKey, model) {
  if (!apiKey) return { success: false, message: 'Please enter an API key.' };
  let targetModel = model?.trim() || 'gemini-3.8-flash';

  // Test across API versions with the exact model Google asked for
  const endpoints = [
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    `https://generativelanguage.googleapis.com/v1alpha/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`
  ];

  let lastMsg = '';
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hello' }] }]
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const ver = url.includes('/v1alpha/') ? 'v1alpha' : url.includes('/v1beta/') ? 'v1beta' : 'v1';
        await chrome.storage.local.set({ geminiModel: targetModel, activeApiVersion: ver });
        return { success: true, message: `Connected to ${targetModel} (${ver}) successfully!` };
      } else {
        lastMsg = data?.error?.message || `HTTP ${res.status}`;
      }
    } catch (e) {
      lastMsg = e.message;
    }
  }

  return { success: false, message: lastMsg };
}

async function handleExtractHighlights(selectedText) {
  if (!selectedText || !selectedText.trim()) {
    return { success: false, error: 'EMPTY_SELECTION', message: 'No text selected.' };
  }

  const config = await chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'readingMode', 'activeApiVersion']);
  const apiKey = config.geminiApiKey?.trim();
  const model = config.geminiModel?.trim() || 'gemini-3.8-flash';
  const apiVer = config.activeApiVersion || 'v1beta';
  const mode = config.readingMode || DEFAULT_MODE;

  if (!apiKey) {
    return {
      success: false,
      error: 'MISSING_API_KEY',
      message: 'Gemini API key is not configured. Click the extension icon to set it.'
    };
  }

  const isNearingRateLimit = recordAndCheckRateLimit();
  const modeInstruction = MODE_PROMPTS[mode] || MODE_PROMPTS.general;

  const promptText = `${modeInstruction}

IMPORTANT: You must return valid JSON in this exact structure:
{
  "highlights": [
    {
      "text": "<exact verbatim substring from the source text>",
      "category": "<one of: concept, evidence, critique, takeaway>"
    }
  ]
}

Source text to analyze:
"""
${selectedText}
"""`;

  const candidateUrls = [
    `https://generativelanguage.googleapis.com/${apiVer}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    `https://generativelanguage.googleapis.com/v1alpha/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  ];

  const payload = {
    contents: [
      {
        parts: [{ text: promptText }]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      maxOutputTokens: 1500
    }
  };

  let attempt = 0;
  let lastError = null;

  while (attempt <= MAX_RETRIES) {
    const url = candidateUrls[attempt % candidateUrls.length];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(payload)
      });
      clearTimeout(timer);

      if (response.ok) {
        const data = await response.json();
        let rawContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawContent) {
          return { success: false, error: 'EMPTY_RESPONSE', message: 'Model returned no content.' };
        }

        // Clean any Markdown code blocks ```json ... ``` or stray backticks
        rawContent = rawContent.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

        let parsed = null;
        try {
          parsed = JSON.parse(rawContent);
        } catch (e) {
          // Try extracting JSON object {...} or array [...]
          const matchObj = rawContent.match(/\{[\s\S]*\}/) || rawContent.match(/\[[\s\S]*\]/);
          if (matchObj) {
            try {
              parsed = JSON.parse(matchObj[0]);
            } catch (err2) {}
          }
        }

        let rawHighlights = [];
        if (parsed) {
          if (Array.isArray(parsed.highlights)) {
            rawHighlights = parsed.highlights;
          } else if (Array.isArray(parsed)) {
            rawHighlights = parsed;
          }
        }

        // If JSON parse failed, use regex pattern matching to extract text/category pairs
        if (rawHighlights.length === 0) {
          const itemRegex = /"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*,\s*"category"\s*:\s*"([^"]+)"/g;
          let match;
          while ((match = itemRegex.exec(rawContent)) !== null) {
            rawHighlights.push({
              text: match[1].replace(/\\"/g, '"'),
              category: match[2]
            });
          }
        }

        const verifiedHighlights = rawHighlights
          .filter(h => h && typeof h.text === 'string' && h.text.trim().length > 0)
          .map(h => ({
            text: h.text.trim(),
            category: ['concept', 'evidence', 'critique', 'takeaway'].includes(h.category) ? h.category : 'takeaway'
          }));

        if (verifiedHighlights.length === 0) {
          return { success: false, error: 'PARSE_ERROR', message: 'No valid key points extracted. Try selecting a shorter passage.' };
        }

        return {
          success: true,
          highlights: verifiedHighlights,
          modeUsed: mode,
          rateLimitWarning: isNearingRateLimit
        };
      }

      const errorData = await response.json().catch(() => ({}));
      const statusCode = response.status;
      const errorMessage = errorData?.error?.message || `HTTP ${statusCode}`;

      if ((statusCode === 429 || statusCode === 500 || statusCode === 503) && attempt < MAX_RETRIES) {
        attempt++;
        const delay = (BASE_DELAY_MS * Math.pow(2, attempt - 1)) + (Math.random() * 400);
        console.warn(`[Underline Me] HTTP ${statusCode}. Retrying attempt ${attempt}/${MAX_RETRIES} in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (statusCode === 429) {
        return {
          success: false,
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Gemini rate limit exceeded. Please wait a moment.'
        };
      }

      return { success: false, error: 'API_ERROR', message: errorMessage };

    } catch (networkErr) {
      clearTimeout(timer);
      lastError = networkErr;
      if (networkErr.name === 'AbortError') {
        return { success: false, error: 'TIMEOUT', message: 'API request timed out after 25s.' };
      }
      if (attempt < MAX_RETRIES) {
        attempt++;
        const delay = (BASE_DELAY_MS * Math.pow(2, attempt - 1)) + (Math.random() * 400);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }

  return {
    success: false,
    error: 'NETWORK_ERROR',
    message: lastError?.message || 'Network connection failed.'
  };
}
