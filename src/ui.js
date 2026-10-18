import {
  createIcons,
  FileText,
  File,
  BookOpen,
  Scroll,
  Search,
  Moon,
  Sun,
  Keyboard,
  Download,
  Printer,
  UploadCloud,
  PanelLeft,
  LayoutGrid,
  ListTree,
  History,
  FileUp,
  FolderOpen,
  Sparkles,
  Zap,
  ShieldCheck,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  X,
  Minus,
  Plus,
  MoveHorizontal,
  Maximize2,
  RotateCw,
  Expand,
  FileCheck2,
  Command
} from 'lucide';

export class UIManager {
  constructor(engine) {
    this.engine = engine;

    // Elements
    this.topNav = document.getElementById('top-nav');
    this.sidebar = document.getElementById('sidebar');
    this.viewerArea = document.getElementById('viewer-area');
    this.welcomeScreen = document.getElementById('welcome-screen');
    this.renderStage = document.getElementById('render-stage');
    this.pageNavOverlay = document.getElementById('page-nav-overlay');
    this.bottomDock = document.getElementById('bottom-dock');
    this.dragOverlay = document.getElementById('drag-overlay');
    this.loadingToast = document.getElementById('loading-toast');
    this.loadingToastText = document.getElementById('loading-toast-text');

    // Doc info
    this.docTitle = document.getElementById('doc-title');
    this.docMeta = document.getElementById('doc-meta');

    // Page controls
    this.pageNumInput = document.getElementById('page-num-input');
    this.pageTotal = document.getElementById('page-total');
    this.pageSlider = document.getElementById('page-slider');
    this.btnPagePrev = document.getElementById('btn-page-prev');
    this.btnPageNext = document.getElementById('btn-page-next');
    this.hitboxPrev = document.getElementById('hitbox-prev');
    this.hitboxNext = document.getElementById('hitbox-next');

    // Zoom controls
    this.btnZoomIn = document.getElementById('btn-zoom-in');
    this.btnZoomOut = document.getElementById('btn-zoom-out');
    this.zoomValue = document.getElementById('zoom-value');
    this.btnZoomPreset = document.getElementById('btn-zoom-preset');
    this.zoomMenu = document.getElementById('zoom-menu');
    this.btnFitWidth = document.getElementById('btn-fit-width');
    this.btnFitPage = document.getElementById('btn-fit-page');

    // Extra controls
    this.btnRotate = document.getElementById('btn-rotate');
    this.btnFullscreen = document.getElementById('btn-fullscreen');
    this.btnDownload = document.getElementById('btn-download');
    this.btnPrint = document.getElementById('btn-print');

    // Theme controls
    this.btnThemeToggle = document.getElementById('btn-theme-toggle');
    this.themeMenu = document.getElementById('theme-menu');
    this.themeIcon = document.getElementById('theme-icon');

    // View mode controls
    this.modeButtons = {
      single: document.getElementById('mode-single'),
      dual: document.getElementById('mode-dual'),
      scroll: document.getElementById('mode-scroll'),
    };

    // Sidebar & tabs
    this.btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    this.sidebarTabs = document.querySelectorAll('.sidebar-tabs .tab-btn');
    this.tabPanes = document.querySelectorAll('.tab-pane');
    this.thumbnailsContainer = document.getElementById('thumbnails-container');
    this.tocContainer = document.getElementById('toc-container');
    this.recentsContainer = document.getElementById('recents-container');

    // Search controls
    this.btnSearchToggle = document.getElementById('btn-search-toggle');
    this.searchFloatingBar = document.getElementById('search-floating-bar');
    this.searchInput = document.getElementById('search-input');
    this.searchStats = document.getElementById('search-stats');
    this.btnSearchPrev = document.getElementById('btn-search-prev');
    this.btnSearchNext = document.getElementById('btn-search-next');
    this.btnSearchClose = document.getElementById('btn-search-close');

    // Shortcuts modal
    this.btnShortcuts = document.getElementById('btn-shortcuts');
    this.modalShortcuts = document.getElementById('modal-shortcuts');
    this.btnCloseShortcuts = document.getElementById('btn-close-shortcuts');

    // File inputs & sample
    this.fileInput = document.getElementById('file-input');
    this.welcomeFileInput = document.getElementById('welcome-file-input');
    this.btnLoadSample = document.getElementById('btn-load-sample');

    this.initIcons();
    this.initTheme();
    this.bindEvents();
    this.loadRecentsList();
  }

  initIcons() {
    createIcons({
      icons: {
        FileText,
        File,
        BookOpen,
        Scroll,
        Search,
        Moon,
        Sun,
        Keyboard,
        Download,
        Printer,
        UploadCloud,
        PanelLeft,
        LayoutGrid,
        ListTree,
        History,
        FileUp,
        FolderOpen,
        Sparkles,
        Zap,
        ShieldCheck,
        Eye,
        ChevronLeft,
        ChevronRight,
        ChevronUp,
        ChevronDown,
        X,
        Minus,
        Plus,
        MoveHorizontal,
        Maximize2,
        RotateCw,
        Expand,
        FileCheck2,
        Command
      }
    });
  }

  initTheme() {
    const savedTheme = localStorage.getItem('aeropdf_theme') || 'dark';
    this.setTheme(savedTheme);
  }

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('aeropdf_theme', theme);
    
    // Update theme menu options
    document.querySelectorAll('.theme-opt').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.themeVal === theme);
    });
  }

  bindEvents() {
    // File inputs
    const handleFile = (e) => {
      const file = e.target.files?.[0];
      if (file) this.loadFile(file);
    };
    this.fileInput.addEventListener('change', handleFile);
    this.welcomeFileInput.addEventListener('change', handleFile);

    // Sample document
    this.btnLoadSample.addEventListener('click', () => {
      this.loadUrl('./sample.pdf', 'TraceMonkey-Compiler.pdf');
    });

    // Page navigation
    this.btnPagePrev.addEventListener('click', () => this.engine.prevPage());
    this.btnPageNext.addEventListener('click', () => this.engine.nextPage());
    this.hitboxPrev.addEventListener('click', () => this.engine.prevPage());
    this.hitboxNext.addEventListener('click', () => this.engine.nextPage());

    this.pageNumInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = parseInt(this.pageNumInput.value, 10);
        if (!isNaN(val)) this.engine.goToPage(val);
      }
    });

    this.pageSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.pageNumInput.value = val;
    });

    this.pageSlider.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      this.engine.goToPage(val);
    });

    // Zoom controls
    this.btnZoomIn.addEventListener('click', () => this.engine.zoomIn());
    this.btnZoomOut.addEventListener('click', () => this.engine.zoomOut());
    this.btnFitWidth.addEventListener('click', () => this.engine.setZoom('fit-width'));
    this.btnFitPage.addEventListener('click', () => this.engine.setZoom('fit-page'));

    this.btnZoomPreset.addEventListener('click', (e) => {
      e.stopPropagation();
      this.zoomMenu.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!this.zoomMenu.contains(e.target) && e.target !== this.btnZoomPreset) {
        this.zoomMenu.classList.add('hidden');
      }
      if (!this.themeMenu.contains(e.target) && !this.btnThemeToggle.contains(e.target)) {
        this.themeMenu.classList.remove('show');
      }
    });

    this.zoomMenu.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.zoom;
        if (val === 'fit-page' || val === 'fit-width') {
          this.engine.setZoom(val);
        } else {
          this.engine.setZoom(parseFloat(val));
        }
        this.zoomMenu.classList.add('hidden');
      });
    });

    // Rotate
    this.btnRotate.addEventListener('click', () => this.engine.rotate());

    // Fullscreen
    this.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());

    // Download & Print
    this.btnDownload.addEventListener('click', () => this.engine.download());
    this.btnPrint.addEventListener('click', () => this.engine.print());

    // Theme dropdown
    this.btnThemeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.themeMenu.classList.toggle('show');
    });

    this.themeMenu.querySelectorAll('.theme-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setTheme(btn.dataset.themeVal);
        this.themeMenu.classList.remove('show');
      });
    });

    // View modes
    Object.entries(this.modeButtons).forEach(([mode, btn]) => {
      btn.addEventListener('click', () => {
        Object.values(this.modeButtons).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.engine.setViewMode(mode);
        this.updateOverlayNavVisibility();
      });
    });

    // Sidebar
    this.btnToggleSidebar.addEventListener('click', () => {
      this.sidebar.classList.toggle('collapsed');
      // Re-trigger layout compute scale after animation
      setTimeout(() => this.engine.computeScale(), 300);
    });

    this.sidebarTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.sidebarTabs.forEach(t => t.classList.remove('active'));
        this.tabPanes.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const targetPane = document.getElementById(`pane-${tab.dataset.tab}`);
        if (targetPane) targetPane.classList.add('active');
      });
    });

    // Search
    this.btnSearchToggle.addEventListener('click', () => {
      this.searchFloatingBar.classList.toggle('hidden');
      if (!this.searchFloatingBar.classList.contains('hidden')) {
        this.searchInput.focus();
      }
    });

    this.btnSearchClose.addEventListener('click', () => {
      this.searchFloatingBar.classList.add('hidden');
    });

    let searchTimeout;
    this.searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.engine.search(e.target.value);
      }, 250);
    });

    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          this.engine.prevSearchResult();
        } else {
          this.engine.nextSearchResult();
        }
      } else if (e.key === 'Escape') {
        this.searchFloatingBar.classList.add('hidden');
      }
    });

    this.btnSearchNext.addEventListener('click', () => this.engine.nextSearchResult());
    this.btnSearchPrev.addEventListener('click', () => this.engine.prevSearchResult());

    // Shortcuts Modal
    this.btnShortcuts.addEventListener('click', () => {
      this.modalShortcuts.classList.remove('hidden');
    });
    this.btnCloseShortcuts.addEventListener('click', () => {
      this.modalShortcuts.classList.add('hidden');
    });
    this.modalShortcuts.addEventListener('click', (e) => {
      if (e.target === this.modalShortcuts) {
        this.modalShortcuts.classList.add('hidden');
      }
    });

    // Global Drag & Drop
    let dragCounter = 0;
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      this.dragOverlay.classList.remove('hidden');
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        this.dragOverlay.classList.add('hidden');
      }
    });

    window.addEventListener('dragover', (e) => e.preventDefault());

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      this.dragOverlay.classList.add('hidden');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type === 'application/pdf') {
        this.loadFile(file);
      }
    });

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      // Don't intercept when user is typing in input
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        if (e.key === 'Escape') {
          document.activeElement.blur();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case 'j':
        case 'J':
          e.preventDefault();
          this.engine.nextPage();
          break;
        case ' ': // Space bar
          e.preventDefault();
          if (e.shiftKey) {
            this.engine.prevPage();
          } else {
            this.engine.nextPage();
          }
          break;
        case 'ArrowLeft':
        case 'PageUp':
        case 'k':
        case 'K':
          e.preventDefault();
          this.engine.prevPage();
          break;
        case 'Home':
          e.preventDefault();
          this.engine.goToPage(1);
          break;
        case 'End':
          e.preventDefault();
          this.engine.goToPage(this.engine.totalPages);
          break;
        case '+':
        case '=':
          e.preventDefault();
          this.engine.zoomIn();
          break;
        case '-':
        case '_':
          e.preventDefault();
          this.engine.zoomOut();
          break;
        case '0':
          e.preventDefault();
          this.engine.setZoom(1.0);
          break;
        case 'w':
        case 'W':
          e.preventDefault();
          this.engine.setZoom('fit-width');
          break;
        case 'p':
        case 'P':
          if ((e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this.engine.print();
          } else {
            e.preventDefault();
            this.engine.setZoom('fit-page');
          }
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          this.engine.rotate();
          break;
        case 'f':
        case 'F':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.toggleFullscreen();
          }
          break;
        case 's':
        case 'S':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.sidebar.classList.toggle('collapsed');
          }
          break;
        case 'd':
        case 'D':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.cycleTheme();
          }
          break;
        case '?':
          e.preventDefault();
          this.modalShortcuts.classList.toggle('hidden');
          break;
        case 'Escape':
          this.modalShortcuts.classList.add('hidden');
          this.searchFloatingBar.classList.add('hidden');
          break;
      }

      // Cmd / Ctrl + F for search
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А')) {
        e.preventDefault();
        this.searchFloatingBar.classList.remove('hidden');
        this.searchInput.focus();
        this.searchInput.select();
      }
    });

    // Window resize handler
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (this.engine.zoomMode === 'fit-width' || this.engine.zoomMode === 'fit-page') {
          this.engine.computeScale();
          this.engine.render();
        }
      }, 150);
    });
  }

  cycleTheme() {
    const themes = ['dark', 'light', 'sepia', 'invert'];
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = themes[(themes.indexOf(current) + 1) % themes.length];
    this.setTheme(next);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  showToast(text) {
    this.loadingToastText.textContent = text;
    this.loadingToast.classList.remove('hidden');
  }

  hideToast() {
    this.loadingToast.classList.add('hidden');
  }

  async loadFile(file) {
    this.showToast(`Чтение ${file.name}...`);
    try {
      const buffer = await file.arrayBuffer();
      await this.engine.loadDocument(buffer, file.name);
      this.saveToRecents(file.name);
    } catch (err) {
      alert(`Не удалось открыть PDF файл: ${err.message}`);
    } finally {
      this.hideToast();
    }
  }

  async loadUrl(url, fileName) {
    this.showToast(`Загрузка документа...`);
    try {
      await this.engine.loadDocument(url, fileName);
      this.saveToRecents(fileName, url);
    } catch (err) {
      alert(`Ошибка загрузки: ${err.message}`);
    } finally {
      this.hideToast();
    }
  }

  onDocumentLoaded(info) {
    this.welcomeScreen.classList.add('hidden');
    this.renderStage.classList.remove('hidden');
    this.updateOverlayNavVisibility();

    // Enable download & print
    this.btnDownload.disabled = false;
    this.btnPrint.disabled = false;

    // Doc info
    this.docTitle.textContent = info.fileName;
    this.docMeta.textContent = `${info.numPages} ${this.pluralPages(info.numPages)}`;

    // Page controls
    this.pageTotal.textContent = info.numPages;
    this.pageNumInput.max = info.numPages;
    this.pageSlider.max = info.numPages;

    // Build sidebar
    this.buildThumbnails(info.numPages);
    this.buildOutline();
  }

  updateOverlayNavVisibility() {
    // Only show click hitboxes in single-page and dual-page modes
    if (this.engine.viewMode === 'scroll') {
      this.pageNavOverlay.classList.add('hidden');
    } else {
      this.pageNavOverlay.classList.remove('hidden');
    }
  }

  onPageChange(current, total) {
    this.pageNumInput.value = current;
    this.pageSlider.value = current;

    // Update zoom label
    if (this.engine.zoomMode === 'fit-width') {
      this.zoomValue.textContent = `По ширине (${Math.round(this.engine.currentScale * 100)}%)`;
    } else if (this.engine.zoomMode === 'fit-page') {
      this.zoomValue.textContent = `По странице (${Math.round(this.engine.currentScale * 100)}%)`;
    } else {
      this.zoomValue.textContent = `${Math.round(this.engine.currentScale * 100)}%`;
    }

    // Highlight active thumbnail
    document.querySelectorAll('.thumb-card').forEach(card => {
      const p = parseInt(card.dataset.pageNum, 10);
      const isCurrent = p === current || (this.engine.viewMode === 'dual' && p === current + 1);
      card.classList.toggle('active', isCurrent);
      if (isCurrent && !this.isElementInViewport(card, this.thumbnailsContainer)) {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  onSearchResults(currentMatch, totalMatches) {
    this.searchStats.textContent = `${currentMatch} из ${totalMatches}`;
  }

  buildThumbnails(totalPages) {
    this.thumbnailsContainer.innerHTML = '';
    for (let i = 1; i <= totalPages; i++) {
      const card = document.createElement('div');
      card.className = 'thumb-card';
      card.dataset.pageNum = i;
      if (i === 1) card.classList.add('active');

      const preview = document.createElement('div');
      preview.className = 'thumb-preview';
      const canvas = document.createElement('canvas');
      preview.appendChild(canvas);

      const num = document.createElement('span');
      num.className = 'thumb-num';
      num.textContent = i;

      card.appendChild(preview);
      card.appendChild(num);

      card.addEventListener('click', () => {
        this.engine.goToPage(i);
      });

      this.thumbnailsContainer.appendChild(card);
    }

    // Lazy render thumbnails when visible
    const thumbObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const card = entry.target;
          const pageNum = parseInt(card.dataset.pageNum, 10);
          const canvas = card.querySelector('canvas');
          if (canvas && !canvas.dataset.rendered) {
            canvas.dataset.rendered = 'true';
            this.engine.renderThumbnail(pageNum, canvas);
          }
          thumbObserver.unobserve(card);
        }
      });
    }, { root: this.thumbnailsContainer, rootMargin: '100px' });

    document.querySelectorAll('.thumb-card').forEach(card => thumbObserver.observe(card));
  }

  async buildOutline() {
    this.tocContainer.innerHTML = '';
    const outline = await this.engine.getOutline();

    if (!outline || outline.length === 0) {
      this.tocContainer.innerHTML = '<div class="empty-hint">Оглавление в файле не обнаружено</div>';
      return;
    }

    const renderItems = (items, level = 1) => {
      items.forEach(item => {
        const div = document.createElement('div');
        div.className = `toc-item level-${level}`;
        div.textContent = item.title;
        div.addEventListener('click', async () => {
          if (item.dest) {
            const dest = typeof item.dest === 'string' ? await this.engine.pdfDoc.getDestination(item.dest) : item.dest;
            if (dest) {
              const pageIndex = await this.engine.pdfDoc.getPageIndex(dest[0]);
              this.engine.goToPage(pageIndex + 1);
            }
          }
        });
        this.tocContainer.appendChild(div);
        if (item.items && item.items.length > 0) {
          renderItems(item.items, level + 1);
        }
      });
    };

    renderItems(outline);
  }

  saveToRecents(fileName, url = null) {
    try {
      const recents = JSON.parse(localStorage.getItem('aeropdf_recents') || '[]');
      const filtered = recents.filter(r => r.name !== fileName);
      filtered.unshift({
        name: fileName,
        url: url,
        date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      });
      localStorage.setItem('aeropdf_recents', JSON.stringify(filtered.slice(0, 10)));
      this.loadRecentsList();
    } catch (e) {}
  }

  loadRecentsList() {
    try {
      const recents = JSON.parse(localStorage.getItem('aeropdf_recents') || '[]');
      if (recents.length === 0) {
        this.recentsContainer.innerHTML = '<div class="empty-hint">История документов пуста</div>';
        return;
      }

      this.recentsContainer.innerHTML = '';
      recents.forEach(item => {
        const card = document.createElement('div');
        card.className = 'recent-card';
        card.innerHTML = `
          <i data-lucide="file-text"></i>
          <div class="recent-info">
            <span class="recent-name">${item.name}</span>
            <span class="recent-sub">${item.date}</span>
          </div>
        `;

        if (item.url) {
          card.addEventListener('click', () => {
            this.loadUrl(item.url, item.name);
          });
        }

        this.recentsContainer.appendChild(card);
      });

      this.initIcons();
    } catch (e) {}
  }

  pluralPages(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 19) return 'страниц';
    if (mod10 === 1) return 'страница';
    if (mod10 >= 2 && mod10 <= 4) return 'страницы';
    return 'страниц';
  }

  isElementInViewport(el, parent) {
    const r = el.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    return r.top >= pr.top && r.bottom <= pr.bottom;
  }
}
