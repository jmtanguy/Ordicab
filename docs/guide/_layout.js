(() => {
  const MOBILE_BREAKPOINT = 768;
  const sidebar = document.querySelector('.sidebar');
  const toggle = document.querySelector('[data-guide-nav-toggle]');
  const overlay = document.querySelector('[data-guide-nav-overlay]');

  if (!sidebar || !toggle || !overlay) return;

  const isMobile = () => window.innerWidth <= MOBILE_BREAKPOINT;

  const setOpen = (open) => {
    sidebar.classList.toggle('is-open', open);
    overlay.classList.toggle('is-visible', open);
    overlay.hidden = !open;
    document.body.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  toggle.addEventListener('click', () => {
    setOpen(!sidebar.classList.contains('is-open'));
  });

  overlay.addEventListener('click', () => setOpen(false));

  sidebar.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      if (isMobile()) setOpen(false);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sidebar.classList.contains('is-open')) {
      setOpen(false);
    }
  });

  window.addEventListener('resize', () => {
    if (!isMobile()) {
      setOpen(false);
      overlay.hidden = true;
    }
  });
})();
