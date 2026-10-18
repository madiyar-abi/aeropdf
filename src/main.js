import { PDFViewerEngine } from './pdf-viewer.js';
import { UIManager } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('pages-wrapper');
  const viewerArea = document.getElementById('viewer-area');

  let uiManager;

  const engine = new PDFViewerEngine({
    container,
    viewerArea,
    onPageChange: (current, total) => {
      uiManager?.onPageChange(current, total);
    },
    onDocumentLoaded: (info) => {
      uiManager?.onDocumentLoaded(info);
    },
    onLoadingProgress: (percent) => {
      uiManager?.showToast(`Загрузка... ${percent}%`);
      if (percent >= 100) uiManager?.hideToast();
    },
    onSearchResults: (currentMatch, totalMatches) => {
      uiManager?.onSearchResults(currentMatch, totalMatches);
    }
  });

  uiManager = new UIManager(engine);

  // Auto-load sample PDF if ?demo=1 is in URL or for instant demo
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('demo') === '1') {
    uiManager.loadUrl('./sample.pdf', 'TraceMonkey-Compiler.pdf');
  }
});
