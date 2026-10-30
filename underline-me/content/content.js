// Underline Me - Content Script
// Captures selections (with Shadow DOM support), requests semantic highlights, applies color-coded underlines, and renders toasts.

(() => {
  if (window.__UNDERLINE_ME_INITIALIZED__) return;
  window.__UNDERLINE_ME_INITIALIZED__ = true;

  const CATEGORY_TITLES = {
    concept: 'Core Concept / Definition',
    evidence: 'Evidence / Data / Statistic',
    critique: 'Critique / Caveat / Counterargument',
    takeaway: 'Key Takeaway / Conclusion'
  };

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'TRIGGER_UNDERLINE') {
      const selection = getDeepSelection();
      const hasSelection = !!(selection && !selection.isCollapsed && selection.toString().trim().length >= 3) ||
                           !!(request.fallbackText && request.fallbackText.trim().length >= 3);

      processActiveSelection(request.fallbackText);
      sendResponse({ status: 'processing', hasSelection });
    } else if (request.action === 'SHOW_TOAST') {
      showToast(request.message, request.type);
      sendResponse({ status: 'shown' });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clearAllHighlights();
    }
  }, true);

  function getDeepSelection(root = document) {
    let active = root.activeElement;
    while (active && active.shadowRoot) {
      root = active.shadowRoot;
      active = root.activeElement;
    }
    if (typeof root.getSelection === 'function') {
      const sel = root.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        return sel;
      }
    }
    return document.getSelection();
  }

  async function processActiveSelection(fallbackText = null) {
    const selection = getDeepSelection();
    let selectedText = '';
    const ranges = [];

    if (selection && !selection.isCollapsed && selection.toString().trim()) {
      selectedText = selection.toString().trim();
      for (let i = 0; i < selection.rangeCount; i++) {
        ranges.push(selection.getRangeAt(i).cloneRange());
      }
    } else if (fallbackText && fallbackText.trim()) {
      selectedText = fallbackText.trim();
      const bodyRange = document.createRange();
      bodyRange.selectNodeContents(document.body);
      ranges.push(bodyRange);
    }

    if (!selectedText || selectedText.length < 3) return;

    showToast('Analyzing and extracting key points...', 'loading');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'EXTRACT_HIGHLIGHTS',
        text: selectedText
      });

      if (!response) {
        showToast('Extension disconnected. Please reload the tab.', 'error');
        return;
      }

      if (!response.success) {
        showToast(response.message || 'Highlight extraction failed.', 'error');
        return;
      }

      const highlights = response.highlights || [];
      if (highlights.length === 0) {
        showToast('No key points identified for this text.', 'info');
        return;
      }

      let appliedCount = 0;
      for (const range of ranges) {
        appliedCount += applyHighlightsToRange(range, highlights);
      }

      if (selection && !selection.isCollapsed) {
        selection.removeAllRanges();
      }

      if (appliedCount > 0) {
        const warning = response.rateLimitWarning ? ' (Nearing rate limit)' : '';
        const modeLabel = response.modeUsed ? ` [${response.modeUsed.toUpperCase()}]` : '';
        showToast(`Underlined ${appliedCount} points${modeLabel}${warning}`, 'success');
      } else {
        showToast('Could not match highlights to page text.', 'info');
      }

    } catch (err) {
      console.error('[Underline Me] Highlight processing error:', err);
      showToast('Error communicating with background worker.', 'error');
    }
  }

  function applyHighlightsToRange(range, items) {
    const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

    if (!container) return 0;

    let matchCount = 0;
    // Match longest phrases first to avoid partial conflicts
    const sortedItems = [...items].sort((a, b) => b.text.length - a.text.length);

    for (const item of sortedItems) {
      let phrase = item.text;
      const category = item.category || 'takeaway';
      if (!phrase || phrase.trim().length < 2) continue;

      // Clean phrase of non-standard spaces/quotes for matching
      const cleanPhrase = phrase.trim()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\u00A0/g, ' ');

      const escaped = cleanPhrase
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\s+/g, '\\s+');
      const regex = new RegExp(escaped, 'i');

      let matched = tryHighlightPhrase(container, range, regex, category);
      if (matched) {
        matchCount++;
      } else {
        // If long sentence crossed inline tags (like citations/links), try matching constituent clauses
        const clauses = cleanPhrase.split(/[,;:—–-]|\b(?:and|or|that|which|with|from)\b/i)
          .map(c => c.trim())
          .filter(c => c.length >= 8);

        for (const clause of clauses) {
          const escClause = clause.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
          if (tryHighlightPhrase(container, range, new RegExp(escClause, 'i'), category)) {
            matchCount++;
            break;
          }
        }
      }
    }

    return matchCount;
  }

  function tryHighlightPhrase(container, range, regex, category) {
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.classList?.contains('underline-me-highlight')) {
            return NodeFilter.FILTER_REJECT;
          }
          if (range.intersectsNode(node)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    let textNode;
    while ((textNode = walker.nextNode())) {
      // Normalize node text for matching
      const val = textNode.nodeValue.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u00A0/g, ' ');
      const match = regex.exec(val);
      if (match) {
        try {
          const matchNode = textNode.splitText(match.index);
          matchNode.splitText(match[0].length);

          const mark = document.createElement('mark');
          mark.className = `underline-me-highlight underline-me-${category}`;
          mark.title = `${CATEGORY_TITLES[category] || 'Key Point'} • Click to dismiss`;
          mark.textContent = matchNode.nodeValue;

          mark.addEventListener('click', (e) => {
            e.stopPropagation();
            removeSingleHighlight(mark);
          });

          matchNode.parentNode.replaceChild(mark, matchNode);
          return true;
        } catch (err) {
          console.warn('[Underline Me] DOM wrap error:', err);
        }
      }
    }
    return false;
  }

  function removeSingleHighlight(mark) {
    const parent = mark.parentNode;
    if (!parent) return;

    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  }

  function clearAllHighlights() {
    const marks = document.querySelectorAll('.underline-me-highlight');
    if (marks.length === 0) return;
    marks.forEach(mark => removeSingleHighlight(mark));
    showToast('All highlights cleared', 'info', 1500);
  }

  let toastTimeout = null;
  function showToast(message, type = 'info', duration = 3000) {
    let toast = document.getElementById('underline-me-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'underline-me-toast';
      document.body.appendChild(toast);
    }

    if (toastTimeout) clearTimeout(toastTimeout);

    let iconHtml = '';
    if (type === 'loading') iconHtml = '<span class="underline-me-spinner"></span>';
    else if (type === 'success') iconHtml = '<span class="underline-me-toast-icon">✓</span>';
    else if (type === 'error') iconHtml = '<span class="underline-me-toast-icon">✕</span>';
    else iconHtml = '<span class="underline-me-toast-icon">ℹ</span>';

    toast.className = `underline-me-toast-container underline-me-toast-${type} underline-me-toast-visible`;
    toast.innerHTML = `${iconHtml}<span class="underline-me-toast-text">${message}</span>`;

    if (type !== 'loading') {
      toastTimeout = setTimeout(() => {
        toast.classList.remove('underline-me-toast-visible');
      }, duration);
    }
  }
})();
