(() => {
  const revealItems = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -40px 0px' });
    revealItems.forEach((item) => observer.observe(item));
  }

  const rig = document.getElementById('floatingEmblemRig');
  const stage = document.querySelector('.floating-emblem');
  if (!rig || !stage) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // Lite mode (weak devices, set by perf.js) behaves like reduced motion: no continuous animation loop.
  const still = () => reduceMotion.matches || document.documentElement.dataset.perf === 'lite';
  const current = { x: 0, y: 0, rx: 0, ry: 0, rz: 0, scale: 1, opacity: 1 };
  const target = { ...current };
  let frameId = 0;
  let lastTime = 0;

  function updateTarget() {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const progress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
    target.x = 38 - progress * 205;
    target.y = -32 + progress * 230;
    target.rx = 7 - progress * 18;
    target.ry = -18 + progress * 36;
    target.rz = -5 + progress * 12;
    target.scale = .92 + Math.sin(progress * Math.PI) * .13;
    target.opacity = .9 - Math.sin(progress * Math.PI) * .22;
  }

  function paint(time) {
    frameId = 0;
    if (document.hidden) return;
    const delta = lastTime ? Math.min(48, time - lastTime) : 16;
    lastTime = time;
    const idle = still() ? 0 : time / 1000;
    const idleY = Math.sin(idle * .62) * 10;
    const idleZ = Math.sin(idle * .38) * 1.4;
    const easing = still() ? 1 : 1 - Math.pow(.001, delta / 1000);
    for (const key of Object.keys(current)) current[key] += (target[key] - current[key]) * easing;
    rig.style.transform = `translate3d(-50%,-50%,0) translate3d(${current.x.toFixed(2)}px,${(current.y + idleY).toFixed(2)}px,0) rotateX(${current.rx.toFixed(2)}deg) rotateY(${current.ry.toFixed(2)}deg) rotateZ(${(current.rz + idleZ).toFixed(2)}deg) scale(${current.scale.toFixed(3)})`;
    rig.style.opacity = current.opacity.toFixed(3);
    stage.classList.add('is-ready');
    if (!still()) frameId = requestAnimationFrame(paint);
  }

  function scheduleFrame() {
    updateTarget();
    if (!frameId && !document.hidden) frameId = requestAnimationFrame(paint);
  }

  window.addEventListener('scroll', scheduleFrame, { passive: true });
  window.addEventListener('resize', scheduleFrame, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frameId);
      frameId = 0;
      lastTime = 0;
    } else {
      scheduleFrame();
    }
  });
  reduceMotion.addEventListener?.('change', () => {
    cancelAnimationFrame(frameId);
    frameId = 0;
    lastTime = 0;
    scheduleFrame();
  });

  updateTarget();
  if (still()) paint(performance.now());
  else frameId = requestAnimationFrame(paint);
})();
