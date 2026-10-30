# Underline Me - AI Reading & Study Assistant

A Manifest V3 Chrome Extension that uses the Google Gemini API to extract, semantically categorize, and underline key insights directly on any webpage.

---

## 🌟 Advanced AI Features Added

1. **Multi-Color Semantic Highlighting**:
   - 🔵 **Concept / Definition** (`#3b82f6` - Blue): Foundational terms, theories, and core principles.
   - 🟢 **Evidence / Data / Statistic** (`#10b981` - Green): Empirical metrics, survey results, citations, and formulas.
   - 🟠 **Critique / Caveat** (`#f97316` - Orange): Counterarguments, limitations, and nuances.
   - 🟣 **Action Item / Takeaway** (`#a855f7` - Purple): Concluding insights and actionable advice.

2. **Adaptive Reading & Study Modes**:
   - 🎯 **General Insights**: Balanced extraction for everyday reading.
   - 📚 **Exam Revision**: Focuses on testable facts, formulas, theories, and key dates.
   - ⚡ **Speed Reading**: Ultra-concise, isolating only the top 1–2 anchor phrases per section.
   - 🔍 **Claims & Evidence**: Optimized for fact-checking and research paper analysis.

3. **Robust DOM Preservation**:
   - Uses `TreeWalker` text-node traversal.
   - Pierces Shadow DOM boundaries.
   - Works across iframes.
   - Interactive hover cards & dismissible marks (click to unwrap, `Escape` to clear all).

---

## 🚀 Setup & Installation

1. Open Google Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** (top-left).
4. Select the directory:
   ```
   /Users/tanishthaswami/Downloads/AIProject/underline-me
   ```
5. Click the **Underline Me** icon in the extensions toolbar:
   - Enter your [Google AI Studio Gemini API Key](https://aistudio.google.com/app/apikey).
   - Select your preferred **Reading Mode** (e.g. *Exam Revision*).
   - Click **Test Key** to verify connectivity.
   - Click **Save**.

---

## 📖 How to Use

1. Go to any webpage, article, or study material.
2. Select text (a paragraph or multiple sentences).
3. Press **`Alt + U`** (Windows/Linux) or **`Command + Shift + U`** (macOS), or right-click and choose **"Underline Key Points"**.
4. The key points will be underlined in colors corresponding to their semantic category.
5. **Hover** over any underline to see its classification.
6. **Click** any mark to remove that highlight, or press **`Escape`** to clear all highlights on the page.
