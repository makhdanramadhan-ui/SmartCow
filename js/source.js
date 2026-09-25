// SCSSource: satu interface untuk dua adapter sumber data (sim dan live).
// app.js hanya kenal interface ini: tidak ada cek Firebase tersebar di caller.
// Interface: { kind(), isLive(), start(hooks), stop(), command(on, reason) }
// hooks: { update(arr), live(paket), status(pesan, jenis), seed(baris), ready(ok) }
// command -> 'sent' (live, terkirim) | 'local' (sim, berlaku lokal di app)
//   | 'waiting' (live belum siap).
(function (root) {
  const SIM_AWAL = [30.1, 30.4, 29.8, 30.2, 29.9, 30.0];
  let simTemps = SIM_AWAL.slice();
  let simTimer = 0, watchTimer = 0, watchTries = 0, kind = 'sim', liveReady = false;

  function simTick(cb) {
    simTemps = simTemps.map(t => +(t + (Math.random() - 0.5) * 0.6).toFixed(2));
    cb(simTemps.slice());
  }
  function startSim(hooks) {
    kind = 'sim'; liveReady = false;
    simTick(hooks.update);
    simTimer = setInterval(() => simTick(hooks.update), 2000);
  }
  function stopSim() { if (simTimer) { clearInterval(simTimer); simTimer = 0; } }

  function startLive(hooks) {
    kind = 'live';
    root.SCSFirebase.connect({
      onStatus: (msg, k) => hooks.status && hooks.status(msg, k),
      onTelemetry: (p) => { if (p && Array.isArray(p.s) && hooks.live) hooks.live(p); },
      onSeedLogs: (rows) => hooks.seed && hooks.seed(rows)
    }).then(ok => { liveReady = !!ok; hooks.ready && hooks.ready(liveReady); })
      .catch(e => hooks.status && hooks.status('Firebase: ' + e.message, 'err'));
  }

  const api = {
    kind: () => kind,
    isLive: () => kind === 'live',
    start(hooks) {
      api.stop(); watchTries = 0;
      if (root.SCSFirebase) { startLive(hooks); return kind; }
      startSim(hooks);
      // Modul Firebase dimuat asinkron; naik ke live begitu SDK tiba.
      watchTimer = setInterval(() => {
        if (root.SCSFirebase) { api.stop(); startLive(hooks); return; }
        if (++watchTries === 15 && hooks.status) hooks.status('SDK Firebase tak kunjung tiba (offline atau pemblokir iklan). Simulasi lokal berjalan.', 'sim');
      }, 800);
      return kind;
    },
    stop() {
      stopSim();
      if (watchTimer) { clearInterval(watchTimer); watchTimer = 0; }
      if (root.SCSFirebase) { try { root.SCSFirebase.disconnect(); } catch {} }
    },
    command(on, reason) {
      if (kind !== 'live') return 'local';
      if (!liveReady || !root.SCSFirebase) return 'waiting';
      root.SCSFirebase.pushOverride(on, reason);
      return 'sent';
    }
  };
  root.SCSSource = api;
})(typeof self !== 'undefined' ? self : globalThis);
