(() => {
  document.querySelectorAll('[data-window-action]').forEach(button => {
    button.addEventListener('click', () => window.desktop.windowControl(button.dataset.windowAction));
  });
  const parameters = new URLSearchParams(location.search);
  if (parameters.has('skipStartup')) {
    document.getElementById('startupGuard')?.remove();
    document.body.classList.remove('startup-playing');
    return;
  }
  if (parameters.has('startupSplash')) {
    // Match the native window's client-area origin while the splash covers its frame.
    document.body.style.paddingTop = '0px';
  }
  const frame = document.createElement('iframe');
  frame.id = 'startupFrame';
  frame.title = '拾室启动动画';
  frame.src = 'startup.html';
  let fallback;
  function finish() {
    clearTimeout(fallback);
    window.removeEventListener('message', onMessage);
    frame.remove();
    document.getElementById('startupGuard')?.remove();
    document.querySelector('.app').style.opacity = '';
    document.querySelector('.brand').style.visibility = '';
    document.body.classList.remove('startup-playing');

  }
  function onMessage(event) {
    if (event.source === frame.contentWindow && event.data?.type === 'shishi-startup-complete') finish();
  }
  window.addEventListener('message', onMessage);
  frame.addEventListener('error', finish);
  document.body.append(frame);
  fallback = setTimeout(finish, 9000);
})();
