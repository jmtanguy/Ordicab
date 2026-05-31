;(() => {
  // Sélecteurs des captures d'écran agrandissables (exclut logos / icônes)
  const SELECTOR = '.screenshot-frame img, .gallery-item img, .doc-screenshot'

  const targets = document.querySelectorAll(SELECTOR)
  if (!targets.length) return

  const overlay = document.createElement('div')
  overlay.className = 'lightbox-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.hidden = true

  const img = document.createElement('img')
  img.className = 'lightbox-img'
  img.alt = ''
  overlay.appendChild(img)
  document.body.appendChild(overlay)

  const open = () => {
    overlay.hidden = false
    document.body.classList.add('lightbox-open')
    // Laisser un frame pour que la transition d'opacité se déclenche
    requestAnimationFrame(() => overlay.classList.add('is-open'))
  }

  const close = () => {
    overlay.classList.remove('is-open')
    overlay.hidden = true
    document.body.classList.remove('lightbox-open')
    img.removeAttribute('src')
  }

  targets.forEach((el) => {
    el.style.cursor = 'zoom-in'
    el.addEventListener('click', () => {
      img.src = el.currentSrc || el.src
      img.alt = el.alt || ''
      open()
    })
  })

  overlay.addEventListener('click', close)

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('is-open')) {
      close()
    }
  })
})()
