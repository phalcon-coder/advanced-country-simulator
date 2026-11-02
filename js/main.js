// ================================
//Script for game.html
// ================================

// Mobile interactions: hamburger menu
document.addEventListener('DOMContentLoaded', function() {
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const leftSidebar = document.getElementById('leftSidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');

  // ---- Hamburger menu toggle ----
  function toggleSidebar() {
    leftSidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('active');
    // Prevent body scroll when sidebar is open on mobile
    if (window.innerWidth <= 768) {
      document.body.style.overflow = leftSidebar.classList.contains('open') ? 'hidden' : '';
    }
  }

  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', toggleSidebar);
  }

  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', toggleSidebar);
  }

  // Close sidebar when clicking a nav item (mobile)
  document.querySelectorAll('.module-nav button').forEach(btn => {
    btn.addEventListener('click', function() {
      if (window.innerWidth <= 768) {
        leftSidebar.classList.remove('open');
        sidebarOverlay.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
  });

  // ---- Handle window resize ----
  window.addEventListener('resize', function() {
    if (window.innerWidth > 768) {
      // Reset mobile states
      leftSidebar.classList.remove('open');
      sidebarOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  });

  // ---- Keyboard shortcuts ----
  document.addEventListener('keydown', function(e) {
    // Escape key closes sidebar
    if (e.key === 'Escape') {
      if (leftSidebar.classList.contains('open')) {
        toggleSidebar();
      }
    }
  });
});

// ============================================================
// World Map Modal
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  const worldMapBtn = document.getElementById('iconMap');
  const worldMapModal = document.getElementById('worldMapModal');
  const mapTypeSelect = document.getElementById('mapTypeSelect');
  const mapIframe = document.getElementById('mapIframe');
  const mapLoading = document.getElementById('mapLoading');
  const closeBtn = worldMapModal.querySelector('.modal-close');

  // Map file paths
  const mapFiles = {
    political: 'maps/w_political.html',
    natural: 'maps/w_natural.html',
    infrastructural: 'maps/w_infrastructural.html',
    defence: 'maps/w_defence.html'
  };

  // Function to load map
  function loadMap(type) {
    const mapPath = mapFiles[type] || mapFiles.political;

    // Show loading
    mapLoading.style.display = 'flex';
    mapIframe.style.display = 'none';

    // Load the iframe
    mapIframe.src = mapPath;

    // Hide loading when iframe loads
    mapIframe.onload = function() {
      mapLoading.style.display = 'none';
      mapIframe.style.display = 'block';
    };

    // Fallback: hide loading after 5 seconds even if iframe doesn't fire onload
    setTimeout(function() {
      if (mapLoading.style.display !== 'none') {
        mapLoading.style.display = 'none';
        mapIframe.style.display = 'block';
      }
    }, 5000);
  }

  // Open modal
  function openWorldMap() {
    worldMapModal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Load default map (political)
    const defaultType = mapTypeSelect.value || 'political';
    loadMap(defaultType);
  }

  // Close modal
  function closeWorldMap() {
    worldMapModal.classList.remove('active');
    document.body.style.overflow = '';
    // Clear iframe to stop any ongoing loading
    setTimeout(() => {
      mapIframe.src = '';
      mapLoading.style.display = 'flex';
      mapIframe.style.display = 'none';
    }, 300);
  }

  // Event listeners
  if (worldMapBtn) {
    worldMapBtn.addEventListener('click', openWorldMap);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeWorldMap);
  }

  // Close modal on overlay click
  worldMapModal.addEventListener('click', function(e) {
    if (e.target === this) {
      closeWorldMap();
    }
  });

  // Close modal on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && worldMapModal.classList.contains('active')) {
      closeWorldMap();
    }
  });

  // Map type change
  if (mapTypeSelect) {
    mapTypeSelect.addEventListener('change', function() {
      loadMap(this.value);
    });
  }
});
