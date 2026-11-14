/* Live Transcribe — Safari Web Speech API with auto-restart.
 * No build step, no dependencies. */
(function () {
  'use strict';

  var SIZE_STEPS = [40, 56, 72, 96];
  var SIZE_KEY = 'liveTranscribe.size';
  var THEME_KEY = 'liveTranscribe.theme';
  var LANG = 'en-GB';

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function $(id) { return document.getElementById(id); }

  var els = {
    start: $('startScreen'),
    live: $('liveScreen'),
    startBtn: $('startBtn'),
    unsupported: $('unsupported'),
    sizeDown: $('sizeDown'),
    sizeUp: $('sizeUp'),
    themeBtn: $('themeBtn'),
    diag: $('diagText'),
    transcript: $('transcript'),
    finals: $('finals'),
    interim: $('interim'),
    empty: $('emptyHint'),
    status: $('status'),
    statusText: $('statusText'),
    error: $('errorBanner'),
    pauseBtn: $('pauseBtn'),
    clearBtn: $('clearBtn'),
    stopBtn: $('stopBtn'),
    sizeDownLive: $('sizeDownLive'),
    sizeUpLive: $('sizeUpLive')
  };

  /* ---------- tiny storage helpers ---------- */

  function read(key, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try { window.localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ }
  }

  /* ---------- state ---------- */

  var sizeIndex = parseInt(read(SIZE_KEY, '1'), 10);
  if (!isFinite(sizeIndex) || sizeIndex < 0 || sizeIndex >= SIZE_STEPS.length) sizeIndex = 1;

  var lightMode = read(THEME_KEY, 'dark') === 'light';

  var recognition = null;
  var shouldRun = false;
  var paused = false;
  var starting = false;
  var restartTimer = 0;
  var finalCount = 0;
  var errorStreak = 0;
  var wakeLock = null;
  var hideTimer = 0;
  var onLiveScreen = false;
  var scrollQueued = false;
  var currentState = 'listening';
  var everStarted = false;

  /* ---------- text rendering ---------- */

  function queuedScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    window.requestAnimationFrame(function () {
      scrollQueued = false;
      els.transcript.scrollTop = els.transcript.scrollHeight;
    });
  }

  function updateEmpty() {
    var hasText = els.finals.childElementCount > 0 || els.interim.textContent.length > 0;
    els.empty.hidden = hasText || currentState === 'error' || currentState === 'paused' ||
      currentState === 'idle';
  }

  function appendFinal(text) {
    var span = document.createElement('span');
    span.className = 'seg';
    span.textContent = text + ' ';
    els.finals.appendChild(span);
    while (els.finals.childElementCount > 80) {
      els.finals.removeChild(els.finals.firstElementChild);
    }
    updateEmpty();
    queuedScroll();
  }

  function setInterim(text) {
    if (els.interim.textContent === text) return;
    els.interim.textContent = text;
    updateEmpty();
    queuedScroll();
  }

  function clearText() {
    els.finals.textContent = '';
    els.interim.textContent = '';
    updateEmpty();
    els.transcript.scrollTop = 0;
  }

  /* ---------- status + errors ---------- */

  function setStatus(state, text) {
    currentState = state;
    els.status.setAttribute('data-state', state);
    els.statusText.textContent = text;
    updateEmpty();
  }

  function showError(html) {
    els.error.innerHTML = html;
    els.error.hidden = false;
    document.body.classList.remove('controls-hidden');
  }

  function clearError() {
    els.error.hidden = true;
    els.error.textContent = '';
  }

  /* ---------- controls auto-hide ---------- */

  function scheduleHide() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(function () {
      if (paused || !els.error.hidden) return;
      document.body.classList.add('controls-hidden');
    }, 6000);
  }

  function showControls() {
    if (!onLiveScreen) return;
    document.body.classList.remove('controls-hidden');
    scheduleHide();
  }

  /* ---------- wake lock ---------- */

  function acquireWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    try {
      navigator.wakeLock.request('screen').then(function (lock) {
        wakeLock = lock;
        lock.addEventListener('release', function () { wakeLock = null; });
      })['catch'](function () { /* not fatal */ });
    } catch (e) { /* not fatal */ }
  }

  function releaseWakeLock() {
    if (!wakeLock) return;
    try { wakeLock.release(); } catch (e) { /* ignore */ }
    wakeLock = null;
  }

  /* ---------- speech recognition ---------- */

  function scheduleRestart(delay) {
    window.clearTimeout(restartTimer);
    restartTimer = window.setTimeout(startRecognition, delay);
  }

  function makeRecognition() {
    var rec = new SR();
    var started = false;
    var watchdog = 0;

    rec.lang = LANG;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    function stopWatchdog() {
      window.clearTimeout(watchdog);
      watchdog = 0;
    }

    // iOS sometimes accepts start() and then never fires anything. Skip this on the
    // very first run so a slow "Allow microphone" tap is never interrupted.
    if (everStarted) {
      watchdog = window.setTimeout(function () {
        if (rec !== recognition || started) return;
        try { rec.abort(); } catch (e) { /* ignore */ }
        scheduleRestart(900);
      }, 12000);
    }

    rec.onstart = function () {
      if (rec !== recognition) return;
      started = true;
      everStarted = true;
      starting = false;
      stopWatchdog();
      setStatus('listening', 'Listening');
      if (errorStreak === 0) clearError();
    };

    rec.onsoundstart = function () {
      if (rec !== recognition) return;
      setStatus('hearing', 'Hearing you');
    };

    rec.onsoundend = function () {
      if (rec !== recognition) return;
      setStatus('listening', 'Listening');
    };

    rec.onresult = function (ev) {
      if (rec !== recognition) return;
      started = true;
      stopWatchdog();
      errorStreak = 0;
      clearError();

      var interimText = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var result = ev.results[i];
        if (result.isFinal) {
          if (i < finalCount) continue;
          finalCount = i + 1;
          var text = result[0].transcript.trim();
          if (text) appendFinal(text);
        } else {
          interimText += result[0].transcript;
        }
      }
      setInterim(interimText);
    };

    rec.onerror = function (ev) {
      if (rec !== recognition) return;
      handleError(ev.error);
    };

    rec.onend = function () {
      if (rec !== recognition) return;
      stopWatchdog();
      starting = false;
      if (!shouldRun || paused) return;

      if (errorStreak >= 5) {
        paused = true;
        updatePauseLabel();
        setStatus('error', 'Paused');
        showError('Could not keep the microphone open. Tap <b>Resume</b> to try again.');
        return;
      }

      // iOS ends recognition after silence / roughly every minute: restart it.
      scheduleRestart(errorStreak ? Math.min(800 * errorStreak, 6000) : 350);
    };

    return rec;
  }

  function startRecognition() {
    if (!SR || !shouldRun || paused) return;
    window.clearTimeout(restartTimer);

    var old = recognition;
    recognition = null;
    if (old) {
      old.onstart = old.onresult = old.onerror = old.onend = null;
      old.onsoundstart = old.onsoundend = null;
      try { old.abort(); } catch (e) { /* ignore */ }
    }

    var rec = makeRecognition();
    recognition = rec;
    finalCount = 0;
    starting = true;

    try {
      rec.start();
    } catch (e) {
      starting = false;
      scheduleRestart(700);
    }
  }

  function handleError(code) {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        shouldRun = false;
        paused = true;
        updatePauseLabel();
        setStatus('error', 'Mic blocked');
        showError(
          '<strong>Microphone blocked.</strong><br>' +
          'Allow it for this site: tap the <b>aA</b> button in Safari\u2019s address bar, ' +
          'then Website Settings &rarr; Microphone &rarr; Allow. Then tap <b>Resume</b>.'
        );
        break;

      case 'audio-capture':
        shouldRun = false;
        paused = true;
        updatePauseLabel();
        setStatus('error', 'No mic');
        showError('<strong>No microphone available.</strong><br>Close other audio apps, then tap <b>Resume</b>.');
        break;

      case 'network':
        errorStreak = Math.min(errorStreak + 1, 6);
        setStatus('error', 'Reconnecting\u2026');
        break;

      case 'language-not-supported':
        shouldRun = false;
        paused = true;
        updatePauseLabel();
        setStatus('error', 'Language');
        showError('<strong>English (UK) is not supported by this recognition service.</strong>');
        break;

      case 'no-speech':
      case 'aborted':
        // Normal; onend schedules the restart.
        break;

      default:
        errorStreak = Math.min(errorStreak + 1, 6);
        setStatus('error', 'Retrying\u2026');
    }
  }

  /* ---------- start / pause / stop ---------- */

  function updatePauseLabel() {
    els.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  }

  function begin() {
    if (!SR) return;
    clearText();
    clearError();
    shouldRun = true;
    paused = false;
    errorStreak = 0;
    onLiveScreen = true;

    els.start.hidden = true;
    els.live.hidden = false;

    updatePauseLabel();
    setStatus('listening', 'Starting\u2026');
    acquireWakeLock();
    showControls();
    startRecognition();
  }

  function stopAll() {
    shouldRun = false;
    paused = false;
    window.clearTimeout(restartTimer);

    var rec = recognition;
    recognition = null;
    if (rec) {
      rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
      rec.onsoundstart = rec.onsoundend = null;
      try { rec.stop(); } catch (e) { /* ignore */ }
    }

    releaseWakeLock();
    setInterim('');
    clearError();
    onLiveScreen = false;

    els.live.hidden = true;
    els.start.hidden = false;
    document.body.classList.remove('controls-hidden');
    window.clearTimeout(hideTimer);
    clearText();
    updatePauseLabel();
  }

  function togglePause() {
    if (!onLiveScreen) return;

    if (!paused) {
      paused = true;
      window.clearTimeout(restartTimer);

      var rec = recognition;
      recognition = null;
      if (rec) {
        rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
        rec.onsoundstart = rec.onsoundend = null;
        try { rec.stop(); } catch (e) { /* ignore */ }
      }

      setInterim('');
      setStatus('paused', 'Paused');
      releaseWakeLock();
      els.error.hidden = true;
      document.body.classList.remove('controls-hidden');
      window.clearTimeout(hideTimer);
    } else {
      // Also the recovery path after a fatal error such as a blocked microphone.
      shouldRun = true;
      paused = false;
      errorStreak = 0;
      clearError();
      setStatus('listening', 'Starting\u2026');
      acquireWakeLock();
      startRecognition();
      showControls();
    }

    updatePauseLabel();
  }

  /* ---------- sizing / theme ---------- */

  function applySize() {
    document.documentElement.style.setProperty('--fs', SIZE_STEPS[sizeIndex] + 'px');
    var atMin = sizeIndex === 0;
    var atMax = sizeIndex === SIZE_STEPS.length - 1;
    els.sizeDown.disabled = atMin;
    els.sizeDownLive.disabled = atMin;
    els.sizeUp.disabled = atMax;
    els.sizeUpLive.disabled = atMax;
    write(SIZE_KEY, sizeIndex);
  }

  function changeSize(delta) {
    var next = Math.min(SIZE_STEPS.length - 1, Math.max(0, sizeIndex + delta));
    if (next === sizeIndex) return;
    sizeIndex = next;
    applySize();
  }

  function applyTheme() {
    document.body.classList.toggle('light', lightMode);
    els.themeBtn.textContent = lightMode ? 'Dark' : 'Light';
    els.themeBtn.setAttribute('aria-label', lightMode ? 'Switch to dark theme' : 'Switch to light theme');
    write(THEME_KEY, lightMode ? 'light' : 'dark');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', lightMode ? '#fbfbf9' : '#08090a');
  }

  /* ---------- diagnostics ---------- */

  function fillDiagnostics() {
    var ua = navigator.userAgent;
    var ios = ua.match(/(?:iPhone OS|CPU OS) (\d+)[._](\d+)/);
    var standalone = navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

    els.diag.textContent = [
      'iOS: ' + (ios ? ios[1] + '.' + ios[2] : 'not detected'),
      'Home-screen mode: ' + (standalone ? 'yes' : 'no'),
      'Speech recognition: ' + (SR ? 'available' : 'MISSING'),
      'Wake lock: ' + ('wakeLock' in navigator ? 'available' : 'missing'),
      'Language: ' + LANG,
      'Browser: ' + ua
    ].join('\n');
  }

  /* ---------- wiring ---------- */

  els.startBtn.addEventListener('click', begin);

  els.sizeDown.addEventListener('click', function () { changeSize(-1); });
  els.sizeUp.addEventListener('click', function () { changeSize(1); });

  els.sizeDownLive.addEventListener('click', function (e) {
    e.stopPropagation();
    changeSize(-1);
    showControls();
  });

  els.sizeUpLive.addEventListener('click', function (e) {
    e.stopPropagation();
    changeSize(1);
    showControls();
  });

  els.themeBtn.addEventListener('click', function () {
    lightMode = !lightMode;
    applyTheme();
  });

  els.pauseBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    togglePause();
  });

  els.clearBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    clearText();
    showControls();
  });

  els.stopBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    stopAll();
  });

  els.error.addEventListener('click', function () {
    clearError();
    scheduleHide();
  });

  els.live.addEventListener('click', function () {
    showControls();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (!shouldRun || paused) return;
    acquireWakeLock();
    if (!recognition) startRecognition();
  });

  /* ---------- init ---------- */

  applySize();
  applyTheme();
  fillDiagnostics();

  if (!SR) {
    els.unsupported.hidden = false;
    els.startBtn.disabled = true;
    els.startBtn.textContent = 'Not supported here';
  }
})();
