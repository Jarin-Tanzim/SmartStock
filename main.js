(() => {
  const header = document.querySelector('[data-header]');
  const toggleBtn = document.querySelector('[data-nav-toggle]');
  const mobileMenu = document.querySelector('[data-mobile-menu]');
  const navLinks = document.querySelector('[data-nav-links]');
  const form = document.querySelector('[data-cta-form]');

  // --- Mobile menu toggle
  const setMenuOpen = (open) => {
    if (!toggleBtn || !mobileMenu) return;
    toggleBtn.setAttribute('aria-expanded', String(open));
    toggleBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');

    mobileMenu.hidden = !open;
    toggleBtn.innerHTML = open
      ? '<i class="fa-solid fa-xmark" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
  };

  if (toggleBtn && mobileMenu) {
    toggleBtn.addEventListener('click', () => {
      const isOpen = toggleBtn.getAttribute('aria-expanded') === 'true';
      setMenuOpen(!isOpen);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      const isOpen = toggleBtn.getAttribute('aria-expanded') === 'true';
      if (!isOpen) return;

      const clickedInside =
        header.contains(e.target) || mobileMenu.contains(e.target);
      if (!clickedInside) setMenuOpen(false);
    });

    // Close on escape
    document.addEventListener('keydown', (e) => {
      const isOpen = toggleBtn.getAttribute('aria-expanded') === 'true';
      if (isOpen && e.key === 'Escape') setMenuOpen(false);
    });
  }

  // --- Smooth scroll with header offset
  const headerHeight = () => {
    const nav = document.querySelector('.nav');
    return nav ? nav.getBoundingClientRect().height : 72;
  };

  const smoothScrollTo = (el) => {
    const y = el.getBoundingClientRect().top + window.pageYOffset - headerHeight() - 8;
    window.scrollTo({ top: y, behavior: 'smooth' });
  };

  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href');
      if (!href || href === '#') return;

      const target = document.querySelector(href);
      if (!target) return;

      e.preventDefault();
      smoothScrollTo(target);
      setMenuOpen(false);
    });
  });

  // --- Animate in on view
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion) {
    const items = document.querySelectorAll('[data-animate]');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('is-in');
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    items.forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll('[data-animate]').forEach((el) => el.classList.add('is-in'));
  }

  // --- CTA form submit (demo behavior)
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const email = input?.value?.trim();
      if (!email) return;

      alert(`Thank you! We'll contact you at ${email}`);
      input.value = '';
    });
  }
})();
