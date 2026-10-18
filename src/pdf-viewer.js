import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export class PDFViewerEngine {
  constructor(options = {}) {
    this.container = options.container;
    this.viewerArea = options.viewerArea;
    this.onPageChange = options.onPageChange || (() => {});
    this.onDocumentLoaded = options.onDocumentLoaded || (() => {});
    this.onLoadingProgress = options.onLoadingProgress || (() => {});
    this.onSearchResults = options.onSearchResults || (() => {});

    this.pdfDoc = null;
    this.currentPage = 1;
    this.totalPages = 0;
    this.currentScale = 1.0;
    this.zoomMode = 'fit-width'; // 'fit-width', 'fit-page', or numeric float
    this.rotation = 0;
    this.viewMode = 'scroll'; // Default to 'scroll' (continuous vertical scroll) as requested by user

    // Page viewports & aspect ratios
    this.pageViewports = new Map(); // pageNum -> viewport at scale 1.0
    this.pageElements = new Map();  // pageNum -> DOM container

    // High performance Render Queue & LRU Cache
    this.renderQueue = [];
    this.isRendering = false;
    this.activeRenderTasks = new Map(); // pageNum -> renderTask
    this.renderedPagesCache = new Map(); // pageNum -> timestamp (LRU tracking)
    this.MAX_CACHED_PAGES = 16; // Keep up to 16 pages rendered at once to prevent memory leaks

    // Single page mode pre-render cache
    this.singlePageCache = new Map();

    // Wheel navigation throttle for single page mode
    this.lastWheelTime = 0;

    // Search state
    this.searchQuery = '';
    this.searchResults = [];
    this.activeMatchIndex = -1;

    this.rawPdfData = null;
    this.fileName = '';

    this.initScrollListener();
    this.initWheelListener();
  }

  // Throttled scroll listener using requestAnimationFrame for 60fps tracking
  initScrollListener() {
    let ticking = false;
    this.viewerArea.addEventListener('scroll', () => {
      if (this.viewMode !== 'scroll' || !this.pdfDoc || ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        this.onScroll();
        ticking = false;
      });
    }, { passive: true });
  }

  // Mouse wheel page flipping for single page / dual page mode
  initWheelListener() {
    this.viewerArea.addEventListener('wheel', (e) => {
      if (this.viewMode === 'scroll' || !this.pdfDoc) return;
      
      const now = Date.now();
      if (now - this.lastWheelTime < 280) return; // Debounce rapid wheel events
      
      if (e.deltaY > 30 || e.deltaX > 30) {
        this.lastWheelTime = now;
        this.nextPage();
      } else if (e.deltaY < -30 || e.deltaX < -30) {
        this.lastWheelTime = now;
        this.prevPage();
      }
    }, { passive: true });
  }

  // Handle continuous scroll: determines visible page & schedules renders
  onScroll() {
    if (this.viewMode !== 'scroll' || !this.pdfDoc) return;

    const scrollTop = this.viewerArea.scrollTop;
    const clientHeight = this.viewerArea.clientHeight;
    const viewportCenter = scrollTop + clientHeight / 2;

    let closestPage = this.currentPage;
    let minDistance = Infinity;

    // Visible range with buffer (pages within 800px of visible viewport)
    const visiblePages = [];

    for (let i = 1; i <= this.totalPages; i++) {
      const el = this.pageElements.get(i);
      if (!el) continue;

      const pageTop = el.offsetTop;
      const pageBottom = pageTop + el.offsetHeight;
      const dist = Math.abs(viewportCenter - (pageTop + el.offsetHeight / 2));

      if (dist < minDistance) {
        minDistance = dist;
        closestPage = i;
      }

      // Check if within render buffer
      if (pageBottom >= scrollTop - 800 && pageTop <= scrollTop + clientHeight + 800) {
        visiblePages.push(i);
      }
    }

    if (closestPage !== this.currentPage) {
      this.currentPage = closestPage;
      this.onPageChange(this.currentPage, this.totalPages);
    }

    // Schedule renders for pages in viewport buffer
    this.prioritizePageRenders(visiblePages);
  }

  // Prioritize pages: visible pages first (closest to center), then others
  prioritizePageRenders(pageNumbers) {
    // Sort pages by distance to current page
    pageNumbers.sort((a, b) => Math.abs(a - this.currentPage) - Math.abs(b - this.currentPage));

    // Cancel queued renders that are no longer in visible range
    this.renderQueue = this.renderQueue.filter(p => pageNumbers.includes(p));

    for (const p of pageNumbers) {
      const el = this.pageElements.get(p);
      if (!el) continue;
      const hasCanvas = el.querySelector('canvas[data-rendered="true"]');
      if (!hasCanvas && !this.renderQueue.includes(p) && !this.activeRenderTasks.has(p)) {
        this.renderQueue.push(p);
      }
    }

    this.processRenderQueue();
  }

  async processRenderQueue() {
    if (this.isRendering || this.renderQueue.length === 0) return;
    this.isRendering = true;

    const pageNum = this.renderQueue.shift();
    const el = this.pageElements.get(pageNum);

    if (el) {
      await this.renderPageCanvas(pageNum, el);
      this.renderedPagesCache.set(pageNum, Date.now());
      this.pruneLRUCache();
    }

    this.isRendering = false;
    if (this.renderQueue.length > 0) {
      requestAnimationFrame(() => this.processRenderQueue());
    }
  }

  // Keep memory light without aggressive flickering
  pruneLRUCache() {
    if (this.renderedPagesCache.size <= this.MAX_CACHED_PAGES) return;

    // Find page furthest from current page that is not in immediate viewport
    let furthestPage = null;
    let maxDist = -1;

    for (const pageNum of this.renderedPagesCache.keys()) {
      const dist = Math.abs(pageNum - this.currentPage);
      if (dist > 3 && dist > maxDist) {
        maxDist = dist;
        furthestPage = pageNum;
      }
    }

    if (furthestPage) {
      const el = this.pageElements.get(furthestPage);
      if (el) {
        const canvas = el.querySelector('canvas');
        if (canvas) {
          canvas.width = 1;
          canvas.height = 1;
          canvas.remove();
        }
        const textLayer = el.querySelector('.text-layer');
        if (textLayer) textLayer.remove();
      }
      this.renderedPagesCache.delete(furthestPage);
    }
  }

  async loadDocument(source, fileName = 'Документ.pdf') {
    this.fileName = fileName;
    this.cancelAllRenders();
    this.renderQueue = [];
    this.renderedPagesCache.clear();
    this.singlePageCache.clear();
    this.pageViewports.clear();
    this.pageElements.clear();
    this.searchResults = [];
    this.searchQuery = '';

    let loadingTask;
    if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
      this.rawPdfData = source;
      loadingTask = pdfjsLib.getDocument({
        data: source,
        cMapUrl: './pdfjs/cmaps/',
        cMapPacked: true,
      });
    } else if (typeof source === 'string') {
      loadingTask = pdfjsLib.getDocument({
        url: source,
        cMapUrl: './pdfjs/cmaps/',
        cMapPacked: true,
      });
    } else {
      throw new Error('Неизвестный источник данных PDF');
    }

    loadingTask.onProgress = (progressData) => {
      if (progressData.total > 0) {
        const percent = Math.round((progressData.loaded / progressData.total) * 100);
        this.onLoadingProgress(percent);
      }
    };

    try {
      this.pdfDoc = await loadingTask.promise;
      this.totalPages = this.pdfDoc.numPages;
      this.currentPage = 1;

      if (!this.rawPdfData) {
        this.rawPdfData = await this.pdfDoc.getData();
      }

      // Fast-extract viewports for all pages to ensure instant zero-layout-shift scrolling
      for (let i = 1; i <= Math.min(this.totalPages, 100); i++) {
        const p = await this.pdfDoc.getPage(i);
        const vp = p.getViewport({ scale: 1.0, rotation: this.rotation });
        this.pageViewports.set(i, { width: vp.width, height: vp.height });
      }

      this.computeScale();

      this.onDocumentLoaded({
        numPages: this.totalPages,
        fileName: this.fileName,
        title: this.fileName
      });

      await this.render();
      return this.pdfDoc;
    } catch (err) {
      console.error('Ошибка загрузки PDF:', err);
      throw err;
    }
  }

  computeScale() {
    if (!this.pdfDoc) return;
    const paddingX = 48;
    const paddingY = 80;
    const containerW = Math.max(300, this.viewerArea.clientWidth - paddingX);
    const containerH = Math.max(300, this.viewerArea.clientHeight - paddingY);

    const dims = this.pageViewports.get(1) || { width: 595, height: 842 };

    if (this.zoomMode === 'fit-width') {
      let targetW = containerW;
      if (this.viewMode === 'dual') targetW = (containerW / 2) - 16;
      this.currentScale = Math.min(2.5, Math.max(0.3, targetW / dims.width));
    } else if (this.zoomMode === 'fit-page') {
      const scaleH = containerH / dims.height;
      let targetW = containerW;
      if (this.viewMode === 'dual') targetW = (containerW / 2) - 16;
      const scaleW = targetW / dims.width;
      this.currentScale = Math.min(2.5, Math.max(0.3, Math.min(scaleW, scaleH)));
    } else if (typeof this.zoomMode === 'number') {
      this.currentScale = this.zoomMode;
    }
  }

  setZoom(modeOrScale) {
    if (typeof modeOrScale === 'number') {
      this.zoomMode = Math.min(3.0, Math.max(0.3, modeOrScale));
      this.currentScale = this.zoomMode;
    } else {
      this.zoomMode = modeOrScale;
      this.computeScale();
    }
    this.cancelAllRenders();
    this.renderQueue = [];
    this.renderedPagesCache.clear();
    this.singlePageCache.clear();
    this.render();
  }

  zoomIn() {
    const scales = [0.4, 0.6, 0.75, 0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0, 2.5];
    const next = scales.find(s => s > this.currentScale + 0.05) || (this.currentScale + 0.2);
    this.setZoom(Math.min(2.5, next));
  }

  zoomOut() {
    const scales = [0.4, 0.6, 0.75, 0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0, 2.5];
    const prev = [...scales].reverse().find(s => s < this.currentScale - 0.05) || (this.currentScale - 0.2);
    this.setZoom(Math.max(0.35, prev));
  }

  rotate() {
    this.rotation = (this.rotation + 90) % 360;
    this.pageViewports.clear();
    this.renderedPagesCache.clear();
    this.singlePageCache.clear();
    this.computeScale();
    this.render();
  }

  setViewMode(mode) {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.cancelAllRenders();
    this.renderQueue = [];
    this.renderedPagesCache.clear();
    this.singlePageCache.clear();
    this.computeScale();
    this.render();
  }

  async goToPage(pageNum) {
    if (!this.pdfDoc) return;
    const target = Math.max(1, Math.min(this.totalPages, pageNum));
    this.currentPage = target;

    if (this.viewMode === 'scroll') {
      const el = this.pageElements.get(this.currentPage);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      this.onScroll();
    } else {
      await this.render();
    }

    this.onPageChange(this.currentPage, this.totalPages);
  }

  nextPage() {
    const step = this.viewMode === 'dual' ? 2 : 1;
    if (this.currentPage + step <= this.totalPages) {
      this.goToPage(this.currentPage + step);
    } else if (this.viewMode === 'dual' && this.currentPage < this.totalPages) {
      this.goToPage(this.totalPages);
    }
  }

  prevPage() {
    const step = this.viewMode === 'dual' ? 2 : 1;
    if (this.currentPage - step >= 1) {
      this.goToPage(this.currentPage - step);
    } else if (this.currentPage > 1) {
      this.goToPage(1);
    }
  }

  cancelAllRenders() {
    for (const [key, task] of this.activeRenderTasks.entries()) {
      try {
        task.cancel();
      } catch (e) {}
    }
    this.activeRenderTasks.clear();
  }

  async render() {
    if (!this.pdfDoc) return;
    this.cancelAllRenders();
    this.container.innerHTML = '';
    this.container.className = `pages-wrapper mode-${this.viewMode}`;

    if (this.viewMode === 'scroll') {
      await this.initContinuousScroll();
    } else if (this.viewMode === 'single') {
      await this.renderSinglePage(this.currentPage);
    } else if (this.viewMode === 'dual') {
      await this.renderDualPage(this.currentPage);
    }

    this.onPageChange(this.currentPage, this.totalPages);
  }

  // --- Continuous Scroll: Instant Skeleton Layout & Sequential Render ---
  async initContinuousScroll() {
    this.pageElements.clear();

    const fallbackDims = this.pageViewports.get(1) || { width: 595, height: 842 };

    for (let i = 1; i <= this.totalPages; i++) {
      const dims = this.pageViewports.get(i) || fallbackDims;
      const scaledW = Math.round(dims.width * this.currentScale);
      const scaledH = Math.round(dims.height * this.currentScale);

      const slot = document.createElement('div');
      slot.className = 'page-slot';
      slot.dataset.pageNum = i;
      slot.style.width = `${scaledW}px`;
      slot.style.height = `${scaledH}px`;
      slot.style.minHeight = `${scaledH}px`;

      // Page number watermark
      const watermark = document.createElement('div');
      watermark.className = 'page-watermark';
      watermark.textContent = `Стр. ${i}`;
      slot.appendChild(watermark);

      this.container.appendChild(slot);
      this.pageElements.set(i, slot);
    }

    // Scroll to current page
    const targetSlot = this.pageElements.get(this.currentPage);
    if (targetSlot) {
      targetSlot.scrollIntoView({ block: 'start' });
    }

    // Trigger initial render of visible pages
    requestAnimationFrame(() => this.onScroll());
  }

  // --- Single Page View ---
  async renderSinglePage(pageNum) {
    const dims = this.pageViewports.get(pageNum) || { width: 595, height: 842 };
    const scaledW = Math.round(dims.width * this.currentScale);
    const scaledH = Math.round(dims.height * this.currentScale);

    const slot = document.createElement('div');
    slot.className = 'page-slot single-slot';
    slot.dataset.pageNum = pageNum;
    slot.style.width = `${scaledW}px`;
    slot.style.height = `${scaledH}px`;

    this.container.appendChild(slot);
    this.pageElements.set(pageNum, slot);

    await this.renderPageCanvas(pageNum, slot);
    this.preloadAdjacentPages(pageNum);
  }

  // --- Dual Page View ---
  async renderDualPage(pageNum) {
    const p1 = pageNum;
    const p2 = pageNum + 1 <= this.totalPages ? pageNum + 1 : null;

    const wrap = document.createElement('div');
    wrap.className = 'dual-spread-container';

    const dims1 = this.pageViewports.get(p1) || { width: 595, height: 842 };
    const slot1 = document.createElement('div');
    slot1.className = 'page-slot dual-slot left';
    slot1.dataset.pageNum = p1;
    slot1.style.width = `${Math.round(dims1.width * this.currentScale)}px`;
    slot1.style.height = `${Math.round(dims1.height * this.currentScale)}px`;
    wrap.appendChild(slot1);
    this.pageElements.set(p1, slot1);

    let slot2 = null;
    if (p2) {
      const dims2 = this.pageViewports.get(p2) || { width: 595, height: 842 };
      slot2 = document.createElement('div');
      slot2.className = 'page-slot dual-slot right';
      slot2.dataset.pageNum = p2;
      slot2.style.width = `${Math.round(dims2.width * this.currentScale)}px`;
      slot2.style.height = `${Math.round(dims2.height * this.currentScale)}px`;
      wrap.appendChild(slot2);
      this.pageElements.set(p2, slot2);
    }

    this.container.appendChild(wrap);

    await this.renderPageCanvas(p1, slot1);
    if (p2 && slot2) {
      await this.renderPageCanvas(p2, slot2);
    }
  }

  // Preload next and previous pages in single page mode
  preloadAdjacentPages(currentPage) {
    const nextP = currentPage + 1;
    const prevP = currentPage - 1;

    const idleRunner = window.requestIdleCallback || ((cb) => setTimeout(cb, 80));
    idleRunner(async () => {
      for (const p of [nextP, prevP]) {
        if (p >= 1 && p <= this.totalPages && !this.singlePageCache.has(p)) {
          try {
            const page = await this.pdfDoc.getPage(p);
            const vp = page.getViewport({ scale: this.currentScale, rotation: this.rotation });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { alpha: false });
            const dpr = Math.min(window.devicePixelRatio || 1, 1.75); // Capped for memory efficiency
            
            canvas.width = Math.floor(vp.width * dpr);
            canvas.height = Math.floor(vp.height * dpr);
            ctx.scale(dpr, dpr);

            await page.render({ canvasContext: ctx, viewport: vp }).promise;
            this.singlePageCache.set(p, canvas);
          } catch (e) {}
        }
      }
    });
  }

  // Core Canvas Renderer with devicePixelRatio capping to eliminate Mac GPU lag
  async renderPageCanvas(pageNum, slot) {
    if (!this.pdfDoc) return;

    // Check if slot already has a canvas
    if (slot.querySelector('canvas[data-rendered="true"]')) return;

    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: this.currentScale, rotation: this.rotation });
      
      this.pageViewports.set(pageNum, { width: viewport.width / this.currentScale, height: viewport.height / this.currentScale });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: false });

      // Cap devicePixelRatio at 1.75 (prevents 20MB textures on Mac Retina, zero perceived quality loss)
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      slot.style.width = `${Math.floor(viewport.width)}px`;
      slot.style.height = `${Math.floor(viewport.height)}px`;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Cancel ongoing render on this page if any
      if (this.activeRenderTasks.has(pageNum)) {
        this.activeRenderTasks.get(pageNum).cancel();
      }

      const renderTask = page.render({ canvasContext: ctx, viewport });
      this.activeRenderTasks.set(pageNum, renderTask);

      await renderTask.promise;
      this.activeRenderTasks.delete(pageNum);
      ctx.restore();

      canvas.dataset.rendered = 'true';

      // Remove watermark & insert canvas
      const watermark = slot.querySelector('.page-watermark');
      if (watermark) watermark.remove();

      slot.appendChild(canvas);

      // Render crisp text selection layer
      this.renderTextLayer(pageNum, slot, viewport, page);

    } catch (err) {
      if (err.name !== 'RenderingCancelledException') {
        console.error(`Ошибка отрисовки страницы ${pageNum}:`, err);
      }
    }
  }

  async renderTextLayer(pageNum, container, viewport, pageInstance = null) {
    try {
      const page = pageInstance || await this.pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      const textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'text-layer';
      textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
      textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;
      
      textContent.items.forEach(item => {
        if (!item.str || item.str.trim() === '') return;
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
        
        const span = document.createElement('span');
        span.textContent = item.str;
        span.style.left = `${tx[4]}px`;
        span.style.top = `${tx[5] - fontHeight}px`;
        span.style.fontSize = `${fontHeight}px`;
        span.style.fontFamily = item.fontName || 'sans-serif';

        if (this.searchQuery && item.str.toLowerCase().includes(this.searchQuery.toLowerCase())) {
          span.classList.add('search-highlight');
        }

        textLayerDiv.appendChild(span);
      });

      container.appendChild(textLayerDiv);
    } catch (e) {}
  }

  // Lazy thumbnail generator
  async renderThumbnail(pageNum, canvas) {
    if (!this.pdfDoc) return;
    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 0.22 });
      const ctx = canvas.getContext('2d', { alpha: false });
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (e) {}
  }

  async getOutline() {
    if (!this.pdfDoc) return null;
    try {
      return await this.pdfDoc.getOutline();
    } catch (e) {
      return null;
    }
  }

  async search(query) {
    this.searchQuery = query.trim().toLowerCase();
    this.searchResults = [];
    this.activeMatchIndex = -1;

    if (!this.searchQuery || !this.pdfDoc) {
      this.onSearchResults(0, 0);
      return;
    }

    for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
      const page = await this.pdfDoc.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      
      let index = 0;
      const lower = pageText.toLowerCase();
      while ((index = lower.indexOf(this.searchQuery, index)) !== -1) {
        this.searchResults.push({
          pageNum,
          matchIndex: index,
          preview: pageText.slice(Math.max(0, index - 20), index + 40)
        });
        index += this.searchQuery.length;
      }
    }

    if (this.searchResults.length > 0) {
      this.activeMatchIndex = 0;
      this.goToPage(this.searchResults[0].pageNum);
    }

    this.onSearchResults(this.searchResults.length > 0 ? 1 : 0, this.searchResults.length);
  }

  nextSearchResult() {
    if (this.searchResults.length === 0) return;
    this.activeMatchIndex = (this.activeMatchIndex + 1) % this.searchResults.length;
    const match = this.searchResults[this.activeMatchIndex];
    this.goToPage(match.pageNum);
    this.onSearchResults(this.activeMatchIndex + 1, this.searchResults.length);
  }

  prevSearchResult() {
    if (this.searchResults.length === 0) return;
    this.activeMatchIndex = (this.activeMatchIndex - 1 + this.searchResults.length) % this.searchResults.length;
    const match = this.searchResults[this.activeMatchIndex];
    this.goToPage(match.pageNum);
    this.onSearchResults(this.activeMatchIndex + 1, this.searchResults.length);
  }

  download() {
    if (!this.rawPdfData) return;
    const blob = new Blob([this.rawPdfData], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.fileName || 'document.pdf';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 100);
  }

  print() {
    if (!this.rawPdfData) return;
    const blob = new Blob([this.rawPdfData], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = url;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => {
        iframe.remove();
        URL.revokeObjectURL(url);
      }, 60000);
    };
  }
}
