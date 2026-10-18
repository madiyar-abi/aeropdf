import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure PDF.js worker using Vite asset URL
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
    this.zoomMode = 'fit-width'; // 'fit-width', 'fit-page', or numeric
    this.rotation = 0;
    this.viewMode = 'single'; // 'single', 'dual', 'scroll'
    
    // Cancellation & active render tracking
    this.activeRenderTasks = new Map();
    this.preRenderCache = new Map(); // pageNum -> rendered canvas copy
    
    // Intersection observer for continuous scroll mode
    this.scrollObserver = null;
    this.pageElements = new Map();
    this.pageDimensions = new Map();

    // Search state
    this.searchQuery = '';
    this.searchResults = []; // { pageNum, matchIndex, text }
    this.activeMatchIndex = -1;

    this.rawPdfData = null;
    this.fileName = '';

    this.initObserver();
  }

  initObserver() {
    if (typeof IntersectionObserver === 'undefined') return;
    this.scrollObserver = new IntersectionObserver((entries) => {
      if (this.viewMode !== 'scroll') return;
      entries.forEach(entry => {
        const pageNum = parseInt(entry.target.dataset.pageNum, 10);
        if (entry.isIntersecting) {
          this.renderScrollPage(pageNum);
          // Update current page based on visible page
          this.currentPage = pageNum;
          this.onPageChange(this.currentPage, this.totalPages);
        } else {
          this.unloadScrollPage(pageNum);
        }
      });
    }, {
      root: this.viewerArea,
      rootMargin: '300px 0px 300px 0px',
      threshold: 0.1
    });
  }

  async loadDocument(source, fileName = 'Документ.pdf') {
    this.fileName = fileName;
    this.cancelAllRenders();
    this.preRenderCache.clear();
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

      // Extract raw data if loaded via URL for download button
      if (!this.rawPdfData) {
        this.rawPdfData = await this.pdfDoc.getData();
      }

      // Pre-fetch first page dimensions to compute fit scale
      const firstPage = await this.pdfDoc.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1.0, rotation: this.rotation });
      this.pageDimensions.set(1, { width: viewport.width, height: viewport.height });

      this.computeScale();

      // Notify caller
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
    const paddingX = 40;
    const paddingY = 80;
    const containerW = Math.max(300, this.viewerArea.clientWidth - paddingX);
    const containerH = Math.max(300, this.viewerArea.clientHeight - paddingY);

    const dims = this.pageDimensions.get(1) || { width: 595, height: 842 };
    
    if (this.zoomMode === 'fit-width') {
      let targetW = containerW;
      if (this.viewMode === 'dual') targetW = containerW / 2 - 10;
      this.currentScale = Math.min(3.0, Math.max(0.2, targetW / dims.width));
    } else if (this.zoomMode === 'fit-page') {
      const scaleH = containerH / dims.height;
      let targetW = containerW;
      if (this.viewMode === 'dual') targetW = containerW / 2 - 10;
      const scaleW = targetW / dims.width;
      this.currentScale = Math.min(3.0, Math.max(0.2, Math.min(scaleW, scaleH)));
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
    this.preRenderCache.clear();
    this.render();
  }

  zoomIn() {
    const scales = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
    const next = scales.find(s => s > this.currentScale + 0.05) || (this.currentScale + 0.25);
    this.setZoom(Math.min(3.0, next));
  }

  zoomOut() {
    const scales = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
    const prev = [...scales].reverse().find(s => s < this.currentScale - 0.05) || (this.currentScale - 0.25);
    this.setZoom(Math.max(0.3, prev));
  }

  rotate() {
    this.rotation = (this.rotation + 90) % 360;
    this.preRenderCache.clear();
    this.render();
  }

  setViewMode(mode) {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    this.preRenderCache.clear();
    this.computeScale();
    this.render();
  }

  async goToPage(pageNum) {
    if (!this.pdfDoc) return;
    const target = Math.max(1, Math.min(this.totalPages, pageNum));
    if (this.currentPage === target && this.viewMode !== 'scroll') return;
    this.currentPage = target;

    if (this.viewMode === 'scroll') {
      const el = this.pageElements.get(this.currentPage);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      await this.render();
    }

    this.onPageChange(this.currentPage, this.totalPages);
    this.schedulePreRender();
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
      } catch (e) {
        // ignore canceled
      }
    }
    this.activeRenderTasks.clear();
  }

  async render() {
    if (!this.pdfDoc) return;
    this.cancelAllRenders();
    this.container.innerHTML = '';
    this.container.className = `pages-wrapper mode-${this.viewMode}`;

    if (this.viewMode === 'single') {
      await this.renderSinglePage(this.currentPage);
      this.schedulePreRender();
    } else if (this.viewMode === 'dual') {
      await this.renderDualPage(this.currentPage);
      this.schedulePreRender();
    } else if (this.viewMode === 'scroll') {
      await this.initContinuousScroll();
    }

    this.onPageChange(this.currentPage, this.totalPages);
  }

  // --- Single Page Mode ---
  async renderSinglePage(pageNum) {
    // Check pre-render cache first for 0ms flip!
    const cached = this.preRenderCache.get(pageNum);
    const pageContainer = document.createElement('div');
    pageContainer.className = 'page-container';
    pageContainer.dataset.pageNum = pageNum;
    this.container.appendChild(pageContainer);

    if (cached && cached.scale === this.currentScale && cached.rotation === this.rotation) {
      const canvas = cached.canvas;
      pageContainer.style.width = `${cached.width}px`;
      pageContainer.style.height = `${cached.height}px`;
      pageContainer.appendChild(canvas);
      this.renderTextLayer(pageNum, pageContainer, cached.viewport);
      return;
    }

    await this.renderPageCanvas(pageNum, pageContainer);
  }

  // --- Dual Page Mode ---
  async renderDualPage(pageNum) {
    const p1 = pageNum;
    const p2 = pageNum + 1 <= this.totalPages ? pageNum + 1 : null;

    const wrap1 = document.createElement('div');
    wrap1.className = 'page-container';
    wrap1.dataset.pageNum = p1;
    this.container.appendChild(wrap1);
    await this.renderPageCanvas(p1, wrap1);

    if (p2) {
      const wrap2 = document.createElement('div');
      wrap2.className = 'page-container';
      wrap2.dataset.pageNum = p2;
      this.container.appendChild(wrap2);
      await this.renderPageCanvas(p2, wrap2);
    }
  }

  // --- Continuous Scroll Mode (Virtualized) ---
  async initContinuousScroll() {
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
    }
    this.pageElements.clear();

    const sampleDims = this.pageDimensions.get(1) || { width: 595, height: 842 };
    const scaledW = sampleDims.width * this.currentScale;
    const scaledH = sampleDims.height * this.currentScale;

    // Create placeholders for all pages so scrollbar is authentic
    for (let i = 1; i <= this.totalPages; i++) {
      const pageWrap = document.createElement('div');
      pageWrap.className = 'page-container';
      pageWrap.dataset.pageNum = i;
      pageWrap.style.width = `${scaledW}px`;
      pageWrap.style.height = `${scaledH}px`;
      
      this.container.appendChild(pageWrap);
      this.pageElements.set(i, pageWrap);
      if (this.scrollObserver) {
        this.scrollObserver.observe(pageWrap);
      }
    }

    // Scroll directly to current page
    const currentWrap = this.pageElements.get(this.currentPage);
    if (currentWrap) {
      currentWrap.scrollIntoView({ block: 'start' });
    }
  }

  async renderScrollPage(pageNum) {
    const wrap = this.pageElements.get(pageNum);
    if (!wrap || wrap.querySelector('canvas')) return; // already rendered
    await this.renderPageCanvas(pageNum, wrap);
  }

  unloadScrollPage(pageNum) {
    const wrap = this.pageElements.get(pageNum);
    if (!wrap) return;
    const task = this.activeRenderTasks.get(pageNum);
    if (task) {
      task.cancel();
      this.activeRenderTasks.delete(pageNum);
    }
    // Remove canvas and text layer to free memory
    const canvas = wrap.querySelector('canvas');
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
      canvas.remove();
    }
    const textLayer = wrap.querySelector('.text-layer');
    if (textLayer) textLayer.remove();
  }

  // Core canvas render engine with HiDPI support & cancellation
  async renderPageCanvas(pageNum, container) {
    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: this.currentScale, rotation: this.rotation });
      
      this.pageDimensions.set(pageNum, { width: viewport.width / this.currentScale, height: viewport.height / this.currentScale });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: false });
      
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      container.style.width = `${viewport.width}px`;
      container.style.height = `${viewport.height}px`;

      // Cancel any ongoing render on this page
      if (this.activeRenderTasks.has(pageNum)) {
        this.activeRenderTasks.get(pageNum).cancel();
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      const renderContext = {
        canvasContext: ctx,
        viewport: viewport,
      };

      const renderTask = page.render(renderContext);
      this.activeRenderTasks.set(pageNum, renderTask);

      await renderTask.promise;
      this.activeRenderTasks.delete(pageNum);
      ctx.restore();

      container.innerHTML = '';
      container.appendChild(canvas);

      // Render overlay text layer for selection and search
      this.renderTextLayer(pageNum, container, viewport, page);

    } catch (err) {
      if (err.name !== 'RenderingCancelledException') {
        console.error(`Ошибка отрисовки страницы ${pageNum}:`, err);
      }
    }
  }

  // Smart background pre-rendering for adjacent pages
  schedulePreRender() {
    if (this.viewMode !== 'single') return;
    const nextP = this.currentPage + 1;
    const prevP = this.currentPage - 1;

    // Use requestIdleCallback or setTimeout
    const queue = [];
    if (nextP <= this.totalPages && !this.preRenderCache.has(nextP)) queue.push(nextP);
    if (prevP >= 1 && !this.preRenderCache.has(prevP)) queue.push(prevP);

    if (queue.length === 0) return;

    const idleRunner = window.requestIdleCallback || ((cb) => setTimeout(cb, 100));
    idleRunner(async () => {
      for (const p of queue) {
        if (this.preRenderCache.has(p) || this.activeRenderTasks.has(p)) continue;
        try {
          const page = await this.pdfDoc.getPage(p);
          const viewport = page.getViewport({ scale: this.currentScale, rotation: this.rotation });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { alpha: false });
          const dpr = window.devicePixelRatio || 1;
          
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;

          ctx.save();
          ctx.scale(dpr, dpr);
          const renderTask = page.render({ canvasContext: ctx, viewport });
          this.activeRenderTasks.set(`pre_${p}`, renderTask);
          await renderTask.promise;
          this.activeRenderTasks.delete(`pre_${p}`);
          ctx.restore();

          this.preRenderCache.set(p, {
            canvas,
            width: viewport.width,
            height: viewport.height,
            scale: this.currentScale,
            rotation: this.rotation,
            viewport
          });

          // Limit pre-render cache to 4 pages to avoid memory creep
          if (this.preRenderCache.size > 4) {
            const firstKey = this.preRenderCache.keys().next().value;
            this.preRenderCache.delete(firstKey);
          }
        } catch (e) {
          // ignore cancelled
        }
      }
    });
  }

  // Text layer rendering for smooth text selection
  async renderTextLayer(pageNum, container, viewport, pageInstance = null) {
    try {
      const page = pageInstance || await this.pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      const textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'text-layer';
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      
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

        // Apply search highlights if search is active on this page
        if (this.searchQuery && item.str.toLowerCase().includes(this.searchQuery.toLowerCase())) {
          span.classList.add('search-highlight');
        }

        textLayerDiv.appendChild(span);
      });

      container.appendChild(textLayerDiv);
    } catch (e) {
      // non-critical
    }
  }

  // Generate lazy thumbnail for sidebar
  async renderThumbnail(pageNum, canvas) {
    if (!this.pdfDoc) return;
    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 0.25 });
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: ctx,
        viewport
      }).promise;
    } catch (e) {
      console.warn('Thumbnail render error:', e);
    }
  }

  // Table of Contents / Outline
  async getOutline() {
    if (!this.pdfDoc) return null;
    try {
      return await this.pdfDoc.getOutline();
    } catch (e) {
      return null;
    }
  }

  // In-document Text Search
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

  // Download PDF
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

  // Print PDF
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
